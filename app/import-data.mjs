import { validMoney, validUnits } from './optimizer.mjs'

export function csvRows(text) {
  text = text.replace(/^\uFEFF/, '')
  const out = []
  let row = [], value = '', quoted = false, closed = false
  function cell() { row.push(value); value=''; closed=false }
  for (let i=0;i<text.length;i++) {
    const c=text[i]
    if (quoted) {
      if (c !== '"') value+=c
      else if (text[i+1] === '"') { value+='"'; i++ }
      else { quoted=false; closed=true }
    } else if (c === ',') cell()
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i+1] === '\n') i++
      cell(); out.push(row); row=[]
    } else if (c === '"' && !value && !closed) quoted=true
    else if (closed || c === '"') throw Error('Invalid quoting in CSV record '+(out.length+1))
    else value+=c
  }
  if (quoted) throw Error('Unclosed quoted CSV field.')
  if (value || row.length || closed) { cell(); out.push(row) }
  return out
}

export function cents(value) {
  const raw=String(value ?? '').trim().replace(/^\$\s*/, '')
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null
  const [d,c='']=raw.replaceAll(',','').split('.')
  const n=Number(d)*100+Number(c.padEnd(2,'0'))
  return validMoney(n) ? n : null
}
export function units(value) {
  const raw=String(value ?? '').trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) return null
  const n=Number(raw.replaceAll(',',''))
  return validUnits(n) ? n : null
}

export function approvalKey({supplier,file,sheet,headers,map,raw}) {
  return JSON.stringify([supplier,file,sheet,headers,[map.sku,map.name,map.pack,map.price],raw])
}
export function cleanDemand(text) {
  const rows=csvRows(text).filter(row=>row.some(v=>v.trim()))
  if (JSON.stringify(rows.shift()?.map(v=>v.trim())) !== '["product","units"]') throw Error('Use the product,units template header.')
  const seen=new Set()
  const result=rows.map(([raw,qty,...extra])=>{
    const product=raw.trim(), amount=units(qty)
    if (!product || !amount || extra.length || seen.has(product)) throw Error('Use unique product names and positive whole units on every row.')
    seen.add(product)
    return {product,units:amount}
  })
  if (!result.length || result.length>32) throw Error('Import 1 to 32 demand lines.')
  return result
}
