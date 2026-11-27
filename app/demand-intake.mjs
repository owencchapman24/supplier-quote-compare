import { readQuote } from './workbook.mjs'
import { units } from './import-data.mjs'
import { limits, validUnits } from './optimizer.mjs'
import { esc, option } from './view.mjs'

export function validateDemand(rows) {
  if (!rows.length || rows.length > limits.lines) throw Error('Enter 1 to '+limits.lines+' demand lines.')
  const names = new Set()
  for (const { product, units: quantity, source } of rows) {
    const location = source ? ' (source row '+source.row+')' : ''
    if (!product || !validUnits(quantity)) throw Error('Enter a product and positive whole units up to '+limits.units.toLocaleString('en-US')+location+'.')
    if (names.has(product)) throw Error('Duplicate demand product '+product+location+'.')
    names.add(product)
  }
}

export function demandBasis({ product, units: quantity, source }) {
  if (!source) return 'No source recorded'
  return product === source.product.trim() && quantity === units(source.units)
    ? 'Matches imported demand' : 'Edited from imported demand'
}

const hasData = row => row.some(value => value.trim())

function mappedRows(file, sheet, header, productCol, unitsCol, template = false) {
  const rows = []
  for (let i = header; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i]
    if (!hasData(cells)) continue
    if (template && cells.length > 2) throw Error('Unexpected extra column in template row '+(i+1)+'.')
    const product = cells[productCol] ?? '', quantity = cells[unitsCol] ?? ''
    rows.push({ product: product.trim(), units: units(quantity),
      source: { file, sheet: sheet.name, row: i+1, product, units: quantity } })
    if (rows.length > limits.lines) break
  }
  validateDemand(rows)
  return rows
}

function table(headers, rows) {
  return '<div class="table-scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'
}

export function bindDemandIntake(form, load) {
  const fileInput = form.querySelector('#demandFile'), panel = form.querySelector('#demandMapping')
  const run = form.querySelector('[type=submit]'), error = form.querySelector('#demandError')
  let version = 0

  function close() {
    panel.replaceChildren()
    fileInput.value = ''
    run.disabled = false
  }
  fileInput.onchange = async () => {
    const current = ++version, file = fileInput.files[0]
    const active = () => current === version && form.isConnected
    panel.replaceChildren()
    error.textContent = ''
    run.disabled = Boolean(file)
    if (!file) return
    try {
      const sheets = await readQuote(file)
      if (!active()) return
      const first = sheets[0].rows.findIndex(hasData)
      const headings = sheets[0].rows[first]?.map(v=>v.trim())
      if (/\.csv$/i.test(file.name) && headings?.length === 2 && headings[0] === 'product' && headings[1] === 'units') {
        load(mappedRows(file.name, sheets[0], first+1, 0, 1, true))
        close()
        return
      }
      panel.innerHTML = '<h3>Review demand from '+esc(file.name)+'</h3><div class="field-row">'+
        '<label>Worksheet<select id="demandSheet">'+sheets.map((s,i)=>option(i,s.name)).join('')+'</select></label>'+
        '<label>Header row<input id="demandHeader" type="number" min="1" step="1"></label></div>'+
        '<details open><summary>Raw file preview</summary><div id="demandRaw"></div></details>'+
        '<div class="field-row"><label>Product column<select id="demandProductCol"></select></label>'+
        '<label>Quantity column<select id="demandUnitsCol"></select></label></div>'+
        '<div id="demandPreview"></div><div class="actions"><button type="button" class="primary" id="loadDemand">Load reviewed demand rows</button>'+
        '<button type="button" class="quiet" id="discardDemand">Discard file</button></div>'
      const get = id => panel.querySelector('#'+id)
      const sheetInput = get('demandSheet'), headerInput = get('demandHeader')
      const product = get('demandProductCol'), quantity = get('demandUnitsCol')
      const confirm = get('loadDemand'), preview = get('demandPreview')
      let sheet, reviewed

      function review() {
        reviewed = null
        confirm.disabled = true
        preview.replaceChildren()
        error.textContent = ''
        const header = headerInput.valueAsNumber
        if (!Number.isInteger(header) || !sheet.rows[header-1]?.length) {
          error.textContent = 'Select a worksheet row containing the column headings.'
          return
        }
        if (!product.value || !quantity.value || product.value === quantity.value) {
          preview.textContent = 'Choose two distinct columns to preview demand.'
          return
        }
        try {
          reviewed = mappedRows(file.name, sheet, header, Number(product.value), Number(quantity.value))
          preview.innerHTML = '<h3>Demand preview</h3>'+table(['Source row','Product','Units needed'],
            reviewed.map(d=>[d.source.row,d.product,d.units]))
          confirm.disabled = false
        } catch (e) { error.textContent = e.message }
      }
      function columns() {
        const index = headerInput.valueAsNumber-1, headers = sheet.rows[index] || []
        const start = Math.max(0, index-1) || 0
        const sample = sheet.rows.slice(start,start+8)
        get('demandRaw').innerHTML = table(['Row',...Array.from({length:Math.max(0,...sample.map(r=>r.length))},(_,i)=>i+1)],
          sample.map((row,i)=>[start+i+1,...row]))
        const choices = option('','Choose column')+headers.map((h,i)=>option(i,(i+1)+' · '+h)).join('')
        product.innerHTML = quantity.innerHTML = choices
        for (const [select,pattern] of [[product,/product|item|description/i],[quantity,/units|quantity|qty/i]]) {
          const found = headers.findIndex(h=>pattern.test(h))
          if (found >= 0) select.value = String(found)
        }
        review()
      }
      function worksheet() {
        sheet = sheets[Number(sheetInput.value)]
        headerInput.value = '1'
        headerInput.max = sheet.rows.length
        columns()
      }
      sheetInput.onchange = worksheet
      headerInput.oninput = columns
      product.onchange = quantity.onchange = review
      confirm.onclick = () => { if (reviewed) { load(reviewed); close() } }
      get('discardDemand').onclick = () => { error.textContent = ''; close() }
      worksheet()
    } catch (e) {
      if (active()) { close(); error.textContent = e.message }
    }
  }
}
