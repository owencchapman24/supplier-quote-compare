import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkDownload, downloadSheets } from './buyer-workflows.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE) : 'playwright-core')
const work=path.join(root,'.work')
const out=process.argv.includes('--save-evidence')?path.join(root,'evidence'):work
await mkdir(work,{recursive:true})
const server=spawn(process.execPath,['server.mjs',...(process.argv.includes('--dist')?['--dist']:[])],{
  cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']
})

// Reconstruct every exported receipt from purchased units and actual order terms.
function checkSplitBook(book,expectedDemand,expectedTotals) {
  const plans=book['Plan comparison'].slice(1), detail=book['All plan orders'].slice(1)
  if(expectedTotals) assert.deepEqual(plans.map(r=>r[5]),expectedTotals)
  assert.equal(plans[0][1],'Verified optimum')
  assert.deepEqual(book['Order by supplier'].slice(1),detail.filter(r=>r[0]==='Plan 1'))
  const rules=book['Demand and terms'].filter(r=>r[0]==='Supplier terms')
  for(const [plan,, ,goods,freight,cash,deliveries,excess] of plans) {
    const rows=detail.filter(r=>r[0]===plan)
    const units=new Map(),spend=new Map()
    for(const r of rows.filter(r=>r[2]==='Order line')) {
      assert.ok(Number.isInteger(r[7]) && r[7]>0)
      assert.equal(r[9],r[7]*r[8])
      assert.equal(r[12],r[7]*r[11])
      assert.equal(r[6],undefined)
      assert.equal(r[10],undefined)
      units.set(r[5],(units.get(r[5]) || 0)+r[9])
      spend.set(r[1],(spend.get(r[1]) || 0)+r[12])
    }
    const coverage=rows.filter(r=>r[2]==='Item coverage')
    assert.deepEqual(coverage.map(r=>[r[5],r[6]]),Object.entries(expectedDemand))
    for(const r of coverage) {
      assert.equal(r[19],units.get(r[5]))
      assert.equal(r[10],units.get(r[5])-r[6])
      assert.ok(r[10]>=0)
    }
    assert.equal(excess,coverage.reduce((n,r)=>n+r[10],0))
    const fees=rows.filter(r=>r[2]==='Order delivery')
    assert.equal(fees.length,spend.size)
    assert.deepEqual(new Set(fees.map(r=>r[1])),new Set(spend.keys()))
    for(const r of fees) {
      const terms=rules.find(s=>s[1]===r[1]), sub=spend.get(r[1])
      assert.ok(sub>=terms[4])
      assert.equal(r[13],terms[5]!=null && sub>=terms[5]?0:terms[3])
      assert.equal(r[18],sub+r[13])
    }
    assert.equal(deliveries,fees.length)
    assert.equal(freight,fees.reduce((n,r)=>n+r[13],0))
    assert.equal(goods,[...spend.values()].reduce((a,b)=>a+b,0))
    assert.equal(cash,goods+freight)
  }
}

let browser
try {
  const [ready]=await once(server.stdout,'data')
  browser=await chromium.launch({channel:'msedge'})
  const page=await browser.newPage({viewport:{width:1366,height:1080}})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0])
  const split=page.getByRole('checkbox',{name:'Allow split sourcing'})
  const button=name=>page.getByRole('button',{name})
  const cups='Cups · 12 oz', lids='Lids · 90 mm'
  const demand=q=>({[cups]:q,[lids]:1000})
  const totals=()=>page.locator('#cashOrders .total strong').allTextContents()
  assert.equal(await page.evaluate(()=>localStorage.length),0)
  assert.equal(await split.isChecked(),false)
  await button('Start reviewed cups demo').click()
  await button('Add compatible lids to demand').click()
  await button('Run comparison').click()
  assert.equal((await totals())[0],'$141.00')
  await split.check()
  assert.equal((await totals())[0],'$141.00')
  // Reopen a v1 project saved before the setting existed.
  await page.evaluate(()=>{
    const key='orderbook.workspace.v1',state=JSON.parse(localStorage.getItem(key))
    delete state.allowSplitSourcing
    localStorage.setItem(key,JSON.stringify(state))
  })
  await page.reload()
  assert.equal(await split.isChecked(),false)
  async function setCups(q) {
    await button('Edit demand').click()
    await page.getByLabel('Units needed').first().fill(String(q))
    await button('Run comparison').click()
  }
  await setCups(1750)
  assert.deepEqual(await totals(),['$171.00','$174.00'])
  await checkDownload(page,[171,174],path.join(work,'off-1750.xlsx'))
  await split.check()
  assert.deepEqual(await totals(),['$156.00','$171.00','$174.00'])
  const winner=page.locator('#cashOrders .winning')
  assert.equal(await winner.locator('.receipt-row').count(),3)
  assert.match(await winner.innerText(),/1,750 needed · 1,750 received · 0 excess/)
  await page.locator('#sensitivity > summary').click()
  await page.getByLabel('Range from').fill('1748')
  await page.getByLabel('Through quantity').fill('1753')
  await button('Find intervals').click()
  const intervals=page.locator('#ranges .interval')
  await intervals.filter({hasText:'1,748–1,750'}).waitFor()
  assert.match(await intervals.first().innerText(),/\$156.00/)
  assert.match(await intervals.nth(1).innerText(),/1,751–1,753[\s\S]*\$171.00/)
  await intervals.nth(1).click()
  await button('Apply 1,751 to order demand').waitFor()
  assert.equal(await page.locator('#probeResult .winning .total strong').innerText(),'$171.00')
  await page.locator('#sensitivity > summary').click()
  await page.evaluate(()=>window.scrollTo(0,0))
  await page.locator('#notice.visible').waitFor({state:'hidden'})
  await page.screenshot({path:path.join(out,'split-1750.png')})
  const splitBook=await downloadSheets(page,path.join(out,'split-1750.xlsx'))
  checkSplitBook(splitBook,demand(1750),[156,171,174])
  assert.deepEqual(splitBook['Quantity boundaries'].filter(r=>r[0]===cups).map(r=>[r[1],r[2],r[4]]),[[1748,1750,156],[1751,1753,171]])
  await setCups(1751)
  await page.reload()
  assert.equal(await split.isChecked(),true)
  assert.deepEqual(await totals(),['$171.00','$174.00','$189.00'])
  checkSplitBook(await downloadSheets(page,path.join(work,'split-1751.xlsx')),demand(1751),[171,174,189])
  await split.uncheck()
  await page.reload()
  assert.equal(await split.isChecked(),false)
  assert.deepEqual(await totals(),['$171.00','$174.00'])
  // A real quote import with two compatible cup sizes at one supplier.
  // A $110 order meets its minimum. An extra $20 lid case earns free freight.
  await page.getByRole('navigation').getByRole('link',{name:'Import quote'}).click()
  await page.getByLabel('Supplier name').fill('Warehouse')
  await page.getByLabel('Quote file').setInputFiles({name:'warehouse.csv',mimeType:'text/csv',buffer:Buffer.from(
    'Item code,Item description,Units per case,Case price USD\nCup-L,12 oz cups,1000,50\nCup-S,12 oz cups,751,40\nLid,90 mm lid,1000,20')})
  await page.getByLabel('Worksheet').waitFor()
  for(const [label,index] of [['SKU / item code',0],['Product description',1],['Units per case',2],['Case price (USD)',3]]) {
    await page.getByLabel(label,{exact:true}).selectOption(String(index))
  }
  await page.getByLabel('Fixed delivery fee').fill('45')
  await page.getByLabel('Merchandise minimum').fill('110')
  await page.getByLabel('Free freight',{exact:true}).selectOption('at')
  await page.getByLabel('Free freight at').fill('130')
  await page.getByLabel('I confirm these order terms.').check()
  await button('Review quote lines').click()
  for(const [i,product] of [cups,cups,lids].entries()) {
    await page.locator('#product-'+i).selectOption(product)
    await page.locator('#decision-'+i).selectOption('Confirm offer')
  }
  await button('Import reviewed quote').click()
  await page.getByRole('heading',{name:'Quote library'}).waitFor()
  await page.getByRole('navigation').getByRole('link',{name:'Comparison'}).click()
  await split.check()
  assert.equal((await totals())[0],'$130.00')
  assert.match(await winner.innerText(),/1,000 needed · 2,000 received · 1,000 excess/)
  const imported=await downloadSheets(page)
  checkSplitBook(imported,demand(1751))
  assert.deepEqual(imported['Order by supplier'].filter(r=>r[2]==='Order line').map(r=>[r[3],r[7]]),
    [['Cup-L',1],['Cup-S',1],['Lid',2]])
  assert.deepEqual(errors,[])
  console.log('Edge '+browser.version()+' · fresh and legacy settings, $141 both modes, $171 off / $156 on, $171 after reload at 1,751, worker boundary, $130 same-supplier split with free freight and four workbook downloads passed.')
} finally {
  try { await browser?.close() } finally { server.kill() }
}
