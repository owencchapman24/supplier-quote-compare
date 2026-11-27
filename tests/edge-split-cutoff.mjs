import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../',import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE) : 'playwright-core')
const server = spawn(process.execPath,['server.mjs','--dist'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']})
let browser
try {
  const [ready] = await once(server.stdout,'data')
  browser = await chromium.launch({channel:'msedge'})
  const page = await browser.newPage()
  await page.goto(ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0])
  await page.getByRole('navigation').getByRole('link',{name:'Import quote'}).click()
  await page.getByLabel('Supplier name').fill('Counting fixture')
  const csv = 'SKU,Description,Units per case,Case price USD\r\nX1,Individual cup,1,1.25\r\nX2,Approved individual cup,1,1.00\r\n'
  await page.getByLabel('Quote file').setInputFiles({name:'counting.csv',mimeType:'text/csv',buffer:Buffer.from(csv)})
  await page.getByLabel('Worksheet').waitFor()
  await page.getByLabel('Fixed delivery fee').fill('0')
  await page.getByLabel('Merchandise minimum').fill('0')
  await page.getByLabel('Free freight',{exact:true}).selectOption('none')
  await page.getByLabel('I confirm these order terms.').check()
  await page.getByRole('button',{name:'Review quote lines'}).click()
  for (const i of [0,1]) {
    const selector=page.locator('#product-'+i)
    const name=await selector.locator('option').filter({hasText:'Cups'}).textContent()
    await selector.selectOption({label:name})
    await page.locator('#decision-'+i).selectOption('Confirm offer')
  }
  await page.getByRole('button',{name:'Import reviewed quote'}).click()
  await page.getByRole('heading',{name:'Quote library'}).waitFor()
  await page.getByRole('navigation').getByRole('link',{name:'Comparison',exact:true}).click()
  await page.getByRole('button',{name:'Edit demand'}).click()
  await page.getByLabel('Units needed').first().fill('1000000')
  await page.getByRole('button',{name:'Run comparison'}).click()
  await page.getByLabel('Allow split sourcing').check()
  const status = page.getByText(/Search limit reached.*best found/i).first()
  await status.waitFor()
  const bestTotal = await page.locator('.basket .total strong').first().innerText()
  assert.equal(bestTotal,'$1,000,000.00')
  assert.doesNotMatch(await page.locator('main').innerText(),/Verified optimum/i)
  console.log('Edge at the 100,000-node cutoff:',await status.innerText(),'—',bestTotal)
} finally {
  try {await browser?.close()} finally {server.kill()}
}
