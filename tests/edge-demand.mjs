import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkDownload } from './buyer-workflows.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE) : 'playwright-core')
const server = spawn(process.execPath, ['server.mjs', ...(process.argv.includes('--dist') ? ['--dist'] : [])], {
  cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore','pipe','inherit']
})
let browser
try {
  const [ready] = await once(server.stdout, 'data')
  browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0])
  const button = name => page.getByRole('button', { name })
  const cups = 'Cups · 12 oz', lids = 'Lids · 90 mm'
  await button('Start reviewed cups demo').click()
  await button('Download XLSX').waitFor()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('orderbook.workspace.v1')).demand)
  const before = await saved()
  const bytes = await page.evaluate(async lids => {
    const { writeBook } = await import('/app/xlsx.mjs')
    const blob = await writeBook([
      { name: 'Instructions', headers: ['Buyer notes'], widths: [30], rows: [['Use the November sheet']] },
      { name: 'November', headers: ['Monthly order'], widths: [18,22,30],
        rows: [['Required','Department','Article'], ['2,100','Kitchen','Cup stock'], [], [1000,'Kitchen',lids]] }
    ])
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, lids)
  await button('Edit demand').click()
  const file = 'monthly-demand.xlsx'
  await page.locator('#demandFile').setInputFiles({
    name: file, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes)
  })
  await page.getByLabel('Worksheet').selectOption({ label: 'November' })
  await page.getByLabel('Header row').fill('2')
  await page.getByLabel('Product column').selectOption({ label:'3 · Article' })
  await page.getByLabel('Quantity column').selectOption({ label:'1 · Required' })
  const preview = page.locator('#demandPreview tbody tr')
  assert.deepEqual(await preview.allTextContents(), ['3Cup stock2100','5'+lids+'1000'])
  assert.equal(await page.getByLabel('Demand product').count(), 1)
  assert.equal(await button('Run comparison').isDisabled(), true)
  assert.deepEqual(await saved(), before)
  await button('Load reviewed demand rows').click()
  assert.equal(await page.getByLabel('Demand product').first().inputValue(), 'Cup stock')
  assert.equal(await page.getByLabel('Units needed').first().inputValue(), '2100')
  await page.getByLabel('Demand product').first().fill(cups)
  await page.getByLabel('Units needed').first().fill('1200')
  assert.deepEqual(await saved(), before)
  await button('Run comparison').click()
  await page.reload()
  await page.locator('.basket').first().waitFor()
  assert.deepEqual(await page.locator('.total strong').allTextContents(), ['$141.00','$171.00'])
  const sheets = await checkDownload(page, [141,171])
  const demand = sheets['Demand and terms'].filter(row => row[0] === 'Demand')
  assert.deepEqual(demand.map(row => [row[1],row[2],...row.slice(6)]), [
    [cups,1200,'Edited from imported demand',file,'November',3,'Cup stock','2,100'],
    [lids,1000,'Matches imported demand',file,'November',5,lids,'1000']
  ])
  assert.deepEqual(errors, [])
  console.log('Edge passed XLSX demand mapping, review, explicit save, basket totals and exported source rows.')
} finally {
  try { await browser?.close() } finally { server.kill() }
}
