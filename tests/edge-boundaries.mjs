import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE) : 'playwright-core')
const server = spawn(process.execPath, ['server.mjs', '--dist'], {
  cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit']
})
let browser
try {
  const [ready] = await once(server.stdout, 'data')
  const url = ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]
  browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage()
  await page.goto(url)
  await page.locator('#startDemo').click()
  await page.locator('.basket').first().waitFor()
  await page.getByRole('button', { name: 'Edit demand' }).click()
  await page.locator('#demandFile').setInputFiles(path.join(root, 'samples', 'demand-template.csv'))
  await page.getByLabel('Units needed').nth(1).waitFor()
  await page.getByRole('button', { name: 'Run comparison' }).click()
  await page.locator('#sensitivity summary').first().click()
  await page.locator('#ranges .interval').first().waitFor()
  const at1501 = page.locator('#ranges button[data-q="1501"]')
  await at1501.click()
  await page.locator('#probeResult .total strong').first().waitFor()
  assert.match(await at1501.innerText(), /1,501.*2,000/s)
  for (const [qty, winner, amounts] of [
    [1500,'Supplier B',['$141.00','$171.00']],
    [1501,'Supplier A + Supplier B',['$171.00','$174.00']],
    [1750,'Supplier A + Supplier B',['$171.00','$174.00']],
    [2000,'Supplier A + Supplier B',['$171.00','$174.00']],
    [2001,'Supplier B',['$174.00','$219.00']]
  ]) {
    await page.locator('#probeQty').fill(String(qty))
    await page.locator('#inspect').click()
    await page.locator('#probeResult h3').filter({hasText:qty.toLocaleString('en-US')+' units'}).first().waitFor()
    assert.deepEqual(await page.locator('#probeResult .total strong').allTextContents(), amounts)
    assert.equal(await page.locator('#probeResult .basket h3').first().innerText(),winner)
    console.log(qty+' cups plus 1,000 fixed lids: '+winner+', '+amounts.join(' / '))
  }
  await page.getByRole('navigation').getByRole('link',{name:'Import quote',exact:true}).click()
  await page.getByLabel('Supplier name').fill('Supplier A')
  const original = await readFile(path.join(root,'samples','supplier-a.csv'),'utf8')
  assert.ok(original.includes('48.00'))
  await page.getByLabel('Quote file').setInputFiles({
    name:'supplier-a.csv', mimeType:'text/csv', buffer:Buffer.from(original.replace('48.00','30.00'))
  })
  await page.getByLabel('Worksheet').waitFor()
  await page.getByLabel('Fixed delivery fee').fill('0')
  await page.getByLabel('Merchandise minimum').fill('0')
  await page.getByLabel('Free freight',{exact:true}).selectOption('none')
  await page.getByLabel('I confirm these order terms.').check()
  await page.getByRole('button',{name:'Review quote lines'}).click()
  assert.equal(await page.locator('#decision-0').inputValue(),'Unresolved')
  assert.equal(await page.locator('#decision-1').inputValue(),'Incompatible')
  const cupName = await page.locator('#product-0 option').filter({hasText:'Cups'}).textContent()
  await page.locator('#product-0').selectOption({ label: cupName })
  await page.locator('#decision-0').selectOption('Confirm offer')
  await page.getByRole('button',{name:'Import reviewed quote'}).click()
  await page.getByRole('heading',{name:'Quote library'}).waitFor()
  await page.getByRole('navigation').getByRole('link',{name:'Comparison',exact:true}).click()
  await page.locator('.basket').first().waitFor()
  assert.deepEqual(await page.locator('.total strong').allTextContents(),['$135.00','$141.00'])
  await page.reload()
  await page.locator('.basket').first().waitFor()
  assert.deepEqual(await page.locator('.total strong').allTextContents(),['$135.00','$141.00'])
  console.log('Reimported A at $30/case, confirmed its changed row, retained the incompatible lid decision, and reloaded $135 vs $141.')
  console.log('Passed in Microsoft Edge '+browser.version())
} finally {
  try { await browser?.close() } finally { server.kill() }
}
