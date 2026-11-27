import assert from 'node:assert/strict'

export async function downloadSheets(page,savePath) {
  const [download]=await Promise.all([
    Promise.race([
      page.waitForEvent('download'),
      page.waitForFunction(()=>document.querySelector('#notice')?.textContent.startsWith('Export failed')).then(async()=>{throw Error(await page.locator('#notice').textContent())})
    ]),
    page.getByRole('button',{name:'Download XLSX'}).click()
  ])
  assert.equal(download.suggestedFilename(),'Orderbook-comparison.xlsx')
  if(savePath) await download.saveAs(savePath)
  const stream=await download.createReadStream(), chunks=[]
  for await(const chunk of stream) chunks.push(chunk)
  // Inspect the actual download as OOXML. Do not call the app's export model.
  const sheets=await page.evaluate(async bytes=>{
    const zip=await JSZip.loadAsync(Uint8Array.from(bytes))
    const xml=async file=>{
      const doc=new DOMParser().parseFromString(await zip.file(file).async('string'),'application/xml')
      if(doc.querySelector('parsererror')) throw Error('Malformed '+file)
      return doc
    }
    const wb=await xml('xl/workbook.xml')
    const sheets={}
    for(const [i,s] of [...wb.querySelectorAll('sheet')].entries()){
      const doc=await xml('xl/worksheets/sheet'+(i+1)+'.xml')
      const rows=[...doc.querySelectorAll('row')].map(row=>{
        const values=[]
        for(const c of row.querySelectorAll('c')){
          const col=c.getAttribute('r').match(/[A-Z]+/)[0]
          const j=[...col].reduce((n,char)=>n*26+char.charCodeAt(0)-64,0)-1
          values[j]=c.getAttribute('t')==='inlineStr'?c.querySelector('t').textContent:Number(c.querySelector('v').textContent)
        }
        return values
      })
      sheets[s.getAttribute('name')]=rows
    }
    return sheets
  },[...Buffer.concat(chunks)])
  return sheets
}

export async function checkDownload(page,expected,savePath) {
  const sheets=await downloadSheets(page,savePath)
  const plans=sheets['Plan comparison'].slice(1)
  assert.deepEqual(plans.map(row=>row[5]),expected)
  const detail=sheets['All plan orders'].slice(1)
  for(const [id,,suppliers,goods,fees,total,deliveries] of plans){
    const rows=detail.filter(r=>r[0]===id)
    const lines=rows.filter(r=>r[2]==='Order line')
    const freight=rows.filter(r=>r[2]==='Order delivery')
    assert.equal(new Set(freight.map(r=>r[1])).size,deliveries,suppliers)
    assert.equal(freight.length,deliveries)
    for(const r of lines){
      assert.equal(r[9],r[7]*r[8]);assert.equal(r[10],r[9]-r[6]);assert.equal(r[12],r[11]*r[7])
      assert.equal(typeof r[14],'string');assert.ok(r[16]>=2)
    }
    assert.equal(lines.reduce((n,r)=>n+r[12],0),goods)
    assert.equal(freight.reduce((n,r)=>n+r[13],0),fees)
    assert.equal(goods+fees,total)
  }
  const quotes=sheets['Quote decisions'].slice(1)
  assert.match(quotes.find(r=>r[3]==='A-80')[9],/80 mm.*90 mm/)
  assert.match(quotes.find(r=>r[3]==='A-12X')[9],/invalid pack/)
  assert.ok(sheets['Source records'].some(r=>r[3]==='supplier-b.xlsx' && r[4]==='Case rates' && r[5]===3 && r[8]==='33'))
  assert.ok(sheets['Quantity boundaries'].slice(1).every(r=>r[2]>=r[1] && r[7].includes('row')))
  return sheets
}

export async function buyerWorkflows(browser,url) {
  const context=await browser.newContext({viewport:{width:1366,height:920},deviceScaleFactor:1})
  try {
    const page=await context.newPage(), errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(url)
    await page.getByRole('button',{name:'Start reviewed cups demo'}).click()
    const home=page.locator('main > section .basket')
    async function totals(expected) {
      await home.first().waitFor()
      assert.deepEqual(await home.locator('.total strong').allTextContents(),expected)
    }
    await totals(['$96.00','$101.00'])
    await page.locator('#sensitivity > summary').click()
    await page.locator('.interval').first().waitFor()
    await page.getByLabel('Inspect quantity').fill('2100')
    await page.getByRole('button',{name:'Compare at quantity'}).click()
    await page.getByRole('button',{name:'Apply 2,100 to order demand'}).waitFor()
    assert.deepEqual(await page.locator('#probeResult .total strong').allTextContents(),['$134.00','$144.00'])
    assert.match(await page.locator('.chips').innerText(),/1,200/)
    await page.getByRole('button',{name:'Apply 2,100 to order demand'}).click()
    await totals(['$134.00','$144.00'])
    await page.getByRole('button',{name:'Add compatible lids to demand'}).click()
    await page.getByLabel('Units needed').first().fill('1200')
    await page.getByRole('button',{name:'Run comparison'}).click()
    await totals(['$141.00','$171.00'])
    await page.locator('#sensitivity > summary').click()
    await page.getByLabel('Required item').selectOption('Lids · 90 mm')
    await page.getByLabel('Through quantity').fill('1000000')
    await page.getByRole('button',{name:'Find intervals'}).click()
    await page.getByRole('button',{name:'Inspect next page'}).click()
    await page.waitForFunction(()=>document.querySelector('.interval')?.innerText.includes('128,001'))
    await page.getByLabel('Range from').fill('1')
    await page.getByLabel('Through quantity').fill('3000')
    await page.getByRole('button',{name:'Find intervals'}).click()
    await page.locator('.interval').nth(1).click()
    await page.getByRole('button',{name:'Apply 1,001 to order demand'}).waitFor()
    assert.deepEqual(await page.locator('#probeResult .total strong').allTextContents(),['$181.00','$211.00'])
    assert.match(await page.locator('.chips').innerText(),/1,000/)
    await page.locator('nav').getByText('Quote library').click()
    await page.getByRole('button',{name:'Revise price'}).first().click()
    await page.getByLabel('New case price (USD)').fill('30')
    await page.getByLabel('Revision source or note').fill('Demo supplier revision for A-12')
    await page.getByRole('checkbox').check()
    await page.getByRole('button',{name:'Save revision'}).click()
    assert.match(await page.locator('main').innerText(),/Source \$48.00/)
    await page.locator('nav').getByText('Comparison').click()
    await totals(['$135.00','$141.00'])
    await page.reload();await totals(['$135.00','$141.00'])
    const revised=await checkDownload(page,[135,141])
    assert.deepEqual(revised['Price revisions'][1].slice(3,5),[48,30])
    const r=revised['Quote decisions'].find(r=>r[3]==='A-12')
    assert.deepEqual(r.slice(7,9),[48,30])
    await page.locator('nav').getByText('Public bid').click()
    const forms=page.locator('.source-offer'), result=page.locator('#historical-result')
    await forms.first().waitFor()
    assert.match(await result.innerText(),/Confirm at least one/)
    for(const i of [0,1]){
      await forms.nth(i).getByRole('checkbox').check()
      await forms.nth(i).getByRole('button').click()
    }
    assert.match(await result.innerText(),/\$76.48.*144 received.*4 excess/)
    assert.match(await result.innerText(),/\$92.00.*140 received/)
    await forms.nth(1).getByRole('combobox').selectOption('1')
    assert.equal(await forms.nth(1).getByRole('checkbox').isChecked(),false)
    await forms.nth(1).getByRole('checkbox').check()
    await forms.nth(1).getByRole('button').click()
    assert.match(await result.innerText(),/\$32.32.*\$16.16.*Lowest eligible cash/)
    await page.reload();await forms.first().waitFor()
    assert.match(await result.innerText(),/\$32.32/)
    const officialBid=page.getByRole('link',{name:/Official MCPS bid tab, page 4/})
    assert.equal(await officialBid.getAttribute('href'),'https://ww2.montgomeryschoolsmd.org/departments/procurement/uploads/9111.7/9111.7%20Bidtab.pdf#page=4')
    await page.locator('nav').getByText('Comparison').click()
    await totals(['$135.00','$141.00'])
    await page.setViewportSize({width:390,height:844})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    assert.deepEqual(errors,[])
    console.log('Edge demo, scenario pages and apply, saved price revision, original and revised XLSX, historical eligibility and mobile layout passed.')
  } finally {await context.close()}
}
