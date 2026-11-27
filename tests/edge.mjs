import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {buyerWorkflows,checkDownload} from './buyer-workflows.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE) : 'playwright-core')
const outputDir = process.argv.includes('--save-evidence') ? path.join(root, 'evidence') : path.join(root, '.work', 'edge-run')
await mkdir(outputDir, {recursive: true})
const keepWorkspace=process.argv.includes('--keep-workspace')
const profile=path.join(root,'.work','buyer-edge')
if (keepWorkspace) {
  await mkdir(path.dirname(profile),{recursive:true})
  await mkdir(profile) // A new demo must never replace a buyer's active workspace.
}
const server=spawn(process.execPath,['server.mjs',...process.argv.includes('--dist')?['--dist']:[]],{cwd:root,env:{...process.env,PORT:keepWorkspace?'4173':'0'},stdio:['ignore','pipe','inherit']})
let browser,context
try {
  const [ready]=await once(server.stdout,'data')
  const url=ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]
  const options={viewport:{width:1400,height:1000},deviceScaleFactor:1}
  if (keepWorkspace) {
    context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,...options})
    browser=context.browser()
  } else {
    browser=await chromium.launch({channel:'msedge',headless:true})
    context=await browser.newContext(options)
  }
  const page=context.pages()[0] || await context.newPage()
  const errors=[]
  page.on('pageerror',err=>errors.push(err.message))
  await page.goto(url)
  const samples=name=>path.join(root,'samples',name)
  const go=async name=>{await page.getByRole('navigation').getByRole('link',{name,exact:true}).click()}
  async function source(name,file) {
    await go('Import quote')
    await page.getByLabel('Supplier name').fill(name)
    await page.getByLabel('Quote file').setInputFiles(file)
    await page.getByLabel('Worksheet').waitFor()
  }
  async function terms(fee) {
    await page.getByLabel('Fixed delivery fee').fill(fee)
    await page.getByLabel('Merchandise minimum').fill('0')
    await page.getByLabel('Free freight',{exact:true}).selectOption('none')
    await page.getByLabel('I confirm these order terms.').check()
  }
  async function review() { await page.getByRole('button',{name:'Review quote lines'}).click(); await page.locator('#review').waitFor() }
  async function approve(i,product) {
    await page.locator('#product-'+i).selectOption(product)
    await page.locator('#decision-'+i).selectOption('Confirm offer')
  }
  async function finish() { await page.getByRole('button',{name:'Import reviewed quote'}).click(); await page.getByRole('heading',{name:'Quote library'}).waitFor() }
  async function assertTotals(label,totals) {
    await page.locator('.basket').first().waitFor()
    const actual=await page.locator('.total strong').allTextContents()
    assert.deepEqual(actual,totals,label)
    console.log(label+'  '+actual.join(' / '))
  }
  const cups='Cups · 12 oz',lids='Lids · 90 mm'
  await source('Supplier A',samples('supplier-a.csv'))
  await page.getByLabel('Units per case',{exact:true}).selectOption('2')
  await terms('0')
  await review()
  await approve(0,cups)
  await page.locator('#product-1').selectOption(lids)
  await page.locator('#decision-1').selectOption('Incompatible')
  await page.getByLabel('Decision note').nth(1).fill('80 mm lid does not fit the required 90 mm cup rim.')
  assert.match(await page.locator('.review-line').nth(2).innerText(),/Missing or invalid pack/)
  await finish()
  await source('Supplier B',samples('supplier-b.xlsx'))
  assert.match(await page.locator('#raw').innerText(),/Delivery per order/)
  await page.getByLabel('Worksheet').selectOption({label:'Case rates'})
  await page.getByLabel('Header row').fill('2')
  for (const [label,index] of [['SKU / item code','0'],['Product description','1'],['Units per case','3'],['Case price (USD)','2']]) await page.getByLabel(label,{exact:true}).selectOption(index)
  await terms('35')
  await review()
  await approve(0,cups)
  await approve(1,lids)
  await finish()
  const suppliers=await page.evaluate(()=>JSON.parse(localStorage.getItem('orderbook.workspace.v1')).suppliers)
  if(process.argv.includes('--capture-demo')) {
    await writeFile(samples('reviewed-demo.json'),JSON.stringify({suppliers},null,2)+'\n')
  } else {
    const captured=JSON.parse(await readFile(samples('reviewed-demo.json'),'utf8'))
    const records=quotes=>quotes.map(({imported,...record})=>record)
    assert.deepEqual(records(captured.suppliers),records(suppliers),'demo must match the real reviewed imports')
  }
  await go('Comparison')
  await assertTotals('1,200 cups', ['$96.00','$101.00'])
  async function edit(qty,addLids=false) {
    await page.getByRole('button',{name:'Edit demand'}).click()
    await page.getByLabel('Units needed').first().fill(qty)
    if (addLids) {
      await page.getByRole('button',{name:'Add item'}).click()
      await page.getByLabel('Demand product').last().fill(lids)
      await page.getByLabel('Units needed').last().fill('1000')
    }
    await page.getByRole('button',{name:'Run comparison'}).click()
  }
  await edit('2100')
  await assertTotals('2,100 cups',['$134.00','$144.00'])
  await edit('1200',true)
  await assertTotals('1,200 cups + 1,000 lids',['$141.00','$171.00'])
  await page.reload()
  await assertTotals('Reloaded complete baskets',['$141.00','$171.00'])
  assert.match(await page.locator('.saving').innerText(),/\$30.00 cash savings/)
  assert.match(await page.locator('.basket').first().innerText(),/1 delivery/)
  assert.match(await page.locator('.basket').last().innerText(),/2 deliveries/)
  assert.match(await page.locator('.single').first().innerText(),/Missing approved Lids/)
  const cupSource=page.locator('.winning .receipt-row details').first()
  await cupSource.locator('summary').click()
  assert.match(await cupSource.innerText(),/supplier-b.xlsx · Case rates · row 3/)
  assert.match(await cupSource.innerText(),/\$33.00 per case/)
  await cupSource.locator('summary').click()
  await page.screenshot({path:path.join(outputDir,'edge-comparison.png'),fullPage:true})
  await checkDownload(page,[141,171],path.join(outputDir,'Orderbook-comparison.xlsx'))
  if (keepWorkspace) {
    console.log('Saved buyer workspace at '+profile+' for '+url)
  } else {
    // Re-open the same export from disk, then change one raw price with the same filename.
    await source('Supplier A',samples('supplier-a.csv')); await terms('0'); await review()
    assert.equal(await page.locator('#decision-0').inputValue(),'Confirm offer')
    assert.equal(await page.locator('#decision-1').inputValue(),'Incompatible')
    await finish()
    const changed=(await readFile(samples('supplier-a.csv'),'utf8')).replace('48.00','47.00')
    await source('Supplier A',{name:'supplier-a.csv',mimeType:'text/csv',buffer:Buffer.from(changed)})
    await review()
    assert.equal(await page.locator('#decision-0').inputValue(),'Unresolved')
    assert.equal(await page.locator('#decision-1').inputValue(),'Incompatible')
    await finish()
    await go('Comparison')
    await assertTotals('Unresolved replacement excluded',['$141.00'])
    assert.match(await page.locator('.single').first().innerText()+await page.locator('.single').last().innerText(),/Unresolved order terms/)

    await page.getByRole('button',{name:'Edit demand'}).click()
    await page.locator('#demandFile').setInputFiles(samples('demand-template.csv'))
    await page.getByRole('button',{name:'Run comparison'}).click()
    await assertTotals('Demand template loaded',['$141.00'])
    await page.getByRole('button',{name:'Edit demand'}).click()
    await page.getByRole('button',{name:'Add item'}).click()
    await page.getByLabel('Demand product').last().fill('Unquoted item')
    await page.getByLabel('Units needed').last().fill('1')
    await page.getByRole('button',{name:'Run comparison'}).click()
    await page.getByRole('heading',{name:'No complete basket'}).waitFor()
    assert.equal(await page.locator('.basket').count(),0)
    const newQuote=changed.replace('47.00','30.00')
    await source('Supplier A',{name:'supplier-a.csv',mimeType:'text/csv',buffer:Buffer.from(newQuote)})
    await terms('0');await review()
    assert.equal(await page.locator('#decision-0').inputValue(),'Unresolved')
    await approve(0,cups);await finish()
    await go('Comparison')
    await page.getByRole('button',{name:'Edit demand'}).click()
    await page.locator('#demandFile').setInputFiles(samples('demand-template.csv'))
    await page.getByRole('button',{name:'Run comparison'}).click()
    await page.reload()
    await assertTotals('Reimported $30 case price after buyer approval',['$135.00','$141.00'])
    const audit=await checkDownload(page,[135,141])
    assert.ok(audit['Quote decisions'].some(r=>r[0]==='Superseded' && r[3]==='A-12' && r[8]===48))
    // Below-minimum demand-only order and a valid whole-case top-up.
    await source('Supplier A',samples('supplier-a.csv'));await terms('0')
    await page.getByLabel('Merchandise minimum').fill('100')
    await review();await approve(0,cups);await finish()
    await go('Comparison')
    await assertTotals('Top-up satisfies the merchandise minimum',['$141.00','$219.00'])
    const basis=page.locator('.basket').last().locator('.order-basis')
    await basis.locator('summary').click()
    assert.match(await basis.innerText(),/\$96.00 falls below the \$100.00 minimum.*Added 1 whole case.*\$144.00 valid merchandise/)
    assert.deepEqual(errors,[])
    await buyerWorkflows(browser,url)
    console.log('Microsoft Edge '+browser.version()+' · UI import, mapping, terms, persistence, reimport and partial exclusion passed')
  }
} finally {
  try { await context?.close(); await browser?.close() } finally { server.kill() }
}
