import { csvRows } from './import-data.mjs'
const nodes=(element,name)=>Array.from(element.getElementsByTagNameNS('*',name))
const cellText=el=>nodes(el,'t').map(n=>n.textContent).join('')

async function xlsxSheets(bytes) {
  const zip=await globalThis.JSZip.loadAsync(bytes)
  async function xml(path) {
    const file=zip.file(path)
    if (!file) throw Error('Missing workbook part '+path)
    const text=await file.async('string')
    const doc=new DOMParser().parseFromString(text,'application/xml')
    if (nodes(doc,'parsererror').length) throw Error('Invalid workbook XML.')
    return doc
  }
  function resolve(base,target) {
    return new URL(target,'https://workbook.local/'+base).pathname.slice(1)
  }
  const rootRels=nodes(await xml('_rels/.rels'),'Relationship')
  const bookPath=rootRels.find(r=>r.getAttribute('Type').endsWith('/officeDocument'))?.getAttribute('Target')?.replace(/^\//,'')
  if (!bookPath) throw Error('Workbook document is missing.')
  const book=await xml(bookPath)
  const relPath=bookPath.replace(/([^/]+)$/,'_rels/$1.rels')
  const rels=nodes(await xml(relPath),'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External')
  const target=r=>resolve(bookPath,r.getAttribute('Target'))
  const shared=rels.find(r=>r.getAttribute('Type').endsWith('/sharedStrings'))
  const strings=shared ? nodes(await xml(target(shared)),'si').map(cellText) : []
  const sheets=[]
  for (const sheet of nodes(book,'sheet')) {
    const rid=Array.from(sheet.attributes).find(a=>a.localName==='id')?.value
    const rel=rels.find(r=>r.getAttribute('Id')===rid)
    if (!rel?.getAttribute('Type').endsWith('/worksheet')) continue
    const rows=[]
    for (const row of nodes(await xml(target(rel)),'row')) {
      const index=Number(row.getAttribute('r') || rows.length+1)-1
      if (index<0 || index>=10000) throw Error('Worksheet exceeds 10,000 rows.')
      while(rows.length<=index) rows.push([])
      for (const cell of nodes(row,'c')) {
        const ref=cell.getAttribute('r')?.match(/^[A-Z]+/i)?.[0].toUpperCase()
        const col=ref ? [...ref].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1 : rows[index].length
        if (col>=256) throw Error('Worksheet exceeds 256 columns.')
        const type=cell.getAttribute('t'), v=nodes(cell,'v')[0]?.textContent ?? ''
        const value=nodes(cell,'f').length || type==='e' ? '' : type==='s' ? strings[Number(v)] ?? '' : type==='inlineStr' ? cellText(cell) : v
        while(rows[index].length<col) rows[index].push('')
        rows[index][col]=value
      }
    }
    sheets.push({name:sheet.getAttribute('name'),rows})
  }
  return sheets
}
export async function readQuote(file) {
  if (file.size>5*1024*1024) throw Error('Use a quote file under 5 MB.')
  let sheets
  if (/\.csv$/i.test(file.name)) sheets=[{name:'CSV',rows:csvRows(await file.text())}]
  else if (/\.xlsx$/i.test(file.name)) sheets=await xlsxSheets(await file.arrayBuffer())
  else throw Error('Choose a CSV or XLSX quote.')
  if (!sheets.some(s=>s.rows.length)) throw Error('No worksheet data found.')
  return sheets
}
