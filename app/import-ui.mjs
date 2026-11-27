import { $, esc, money, number, option, heading, notify } from './view.mjs'
import { cents, units, approvalKey } from './import-data.mjs'
import { readQuote } from './workbook.mjs'

const roles={sku:'SKU / item code',name:'Product description',pack:'Units per case',price:'Case price (USD)'}
const guesses={sku:/sku|stock|code/i,name:/description|name/i,pack:/units|pieces|pack size/i,price:/price|usd|cost/i}
function previewTable(rows,start) {
  return '<div class="table-scroll"><table><tbody>'+rows.map((r,i)=>
    '<tr><th scope="row">'+(start+i+1)+'</th>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>'
  ).join('')+'</tbody></table></div>'
}
export function showImport(state,save) {
  let file,sheets,sheet,headers,map,entries,terms,id,readVersion=0
  const root=$('main')
  root.innerHTML=heading('Quote intake','Import a supplier quote','Choose a local file, map its columns and approve the offers you can buy.')+
    '<section class="panel"><h2>Source file</h2><div class="field-row"><label>Supplier name<input id="supplier" list="supplier-list" placeholder="e.g. Supplier A" maxlength="120"></label><datalist id="supplier-list">'+state.suppliers.map(s=>option(s.id,s.id)).join('')+'</datalist><label>Quote file<input id="quoteFile" type="file" accept=".csv,.xlsx"></label></div><div class="sample-links">Sample quotes <a download href="/samples/supplier-a.csv">Supplier A · CSV ↓</a><a download href="/samples/supplier-b.xlsx">Supplier B · XLSX ↓</a></div></section>'+
    '<section id="mapping" class="panel" hidden></section><section id="review" class="panel" hidden></section><p class="error" role="alert" id="error"></p>'
  const fail=e=>{$('error').textContent=e.message}
  const hideReview=()=>{$('review').hidden=true; $('error').textContent=''}
  $('supplier').oninput=hideReview
  $('quoteFile').onchange=async e=>{
    const version=++readVersion
    hideReview(); $('mapping').hidden=true
    file=e.target.files[0]
    if (!file) return
    try {
      const loaded=await readQuote(file)
      if (version!==readVersion || !root.contains(e.target)) return
      sheets=loaded
      const old=state.suppliers.find(s=>s.id===$('supplier').value.trim() && s.file===file.name)
      $('mapping').hidden=false
      $('mapping').innerHTML='<h2>Map the source</h2><div class="field-row"><label>Worksheet<select id="sheet">'+sheets.map((s,i)=>option(i,s.name)).join('')+'</select></label><label>Header row<input id="headerRow" type="number" min="1" step="1" value="1"></label></div><details open><summary>Raw file preview</summary><div id="raw"></div></details><div id="fields" class="field-row"></div>'+
        '<h2 class="subhead">Order terms</h2><p>Enter USD amounts for this destination and period. Use 0 for no fee or minimum.</p><div class="field-row"><label>Fixed delivery fee<input id="fee" inputmode="decimal"></label><label>Merchandise minimum<input id="minimum" inputmode="decimal"></label><label>Free freight<select aria-label="Free freight" id="freight"><option value="">Unresolved</option><option value="none">No threshold</option><option value="at">At merchandise threshold</option></select></label><label id="thresholdLabel" hidden>Free freight at<input id="threshold" inputmode="decimal"></label></div><label class="check"><input type="checkbox" id="ruleOK">I confirm these order terms.</label><p>Suppliers with unresolved terms are saved and excluded from comparisons.</p><button class="primary" id="preview">Review quote lines →</button>'
      function columns() {
        hideReview()
        const idx=Number($('headerRow').value)-1
        headers=sheet.rows[idx] || []
        const first=Math.max(0,idx-1)
        $('raw').innerHTML=previewTable(sheet.rows.slice(first,first+8),first)
        $('fields').innerHTML=Object.entries(roles).map(([role,label])=>'<label>'+esc(label)+'<select aria-label="'+esc(label)+'" id="col-'+role+'">'+option(-1,'Choose column')+headers.map((h,i)=>option(i,(i+1)+' · '+h)).join('')+'</select></label>').join('')
        for(const role of Object.keys(roles)) {
          const reusable=old && old.sheet===sheet.name && old.headerRow===idx+1 && JSON.stringify(headers)===JSON.stringify(old.headers)
          $('col-'+role).value=reusable ? old.map[role] : headers.findIndex(h=>guesses[role].test(h))
        }
      }
      function worksheet() { sheet=sheets[Number($('sheet').value)]; $('headerRow').value=old?.sheet===sheet.name ? old.headerRow : 1; columns() }
      const oldSheet=sheets.findIndex(s=>s.name===old?.sheet)
      if(oldSheet>=0) $('sheet').value=oldSheet
      worksheet()
      $('sheet').onchange=worksheet
      $('headerRow').oninput=columns
      $('mapping').oninput=hideReview
      $('freight').onchange=()=>{$('thresholdLabel').hidden=$('freight').value!=='at'}
      $('preview').onclick=()=>{try { previewLines() } catch(e) { fail(e) }}
    } catch(e) { fail(e) }
  }
  function previewLines() {
    hideReview()
    id=$('supplier').value.trim()
    if (!id) throw Error('Enter a supplier name.')
    map=Object.fromEntries(Object.keys(roles).map(k=>[k,Number($('col-'+k).value)]))
    const cols=Object.values(map)
    if (cols.includes(-1) || new Set(cols).size!==cols.length) throw Error('Select four distinct source columns.')
    const fee=cents($('fee').value), minimum=cents($('minimum').value), mode=$('freight').value
    const freeAt=mode==='at' ? cents($('threshold').value) : null
    const confirmed=$('ruleOK').checked
    if (confirmed && (fee===null || minimum===null || !mode || (mode==='at' && freeAt===null))) throw Error('Complete all order terms before confirming.')
    terms={fee:confirmed ? fee : null,minimum,freeAt}
    const old=state.suppliers.find(s=>s.id===id)
    // Identical source rows retain their individual decisions in occurrence order.
    const saved=new Map()
    for (const row of old?.rows || []) {
      if (!saved.has(row.key)) saved.set(row.key,[])
      saved.get(row.key).push(row)
    }
    entries=[]
    const start=Number($('headerRow').value)
    sheet.rows.slice(start).forEach((raw,i)=>{
      if (!raw.some(v=>v.trim())) return
      const key=approvalKey({supplier:id,file:file.name,sheet:sheet.name,headers,map,raw})
      const previous=saved.get(key)?.shift()
      const pack=units(raw[map.pack]),price=cents(raw[map.price])
      const sku=raw[map.sku]?.trim(),name=raw[map.name]?.trim()
      const problem=!sku || !name ? 'Missing SKU or description' : !pack ? 'Missing or invalid pack' : !price ? 'Missing or invalid case price' : ''
      entries.push({key,id:sku,supplier:id,name,pack,sourcePrice:price,price:previous?.price ?? price,revisions:previous?.revisions || [],raw,row:start+i+1,product:previous?.product || '',approved:previous?.approved===true && !problem, status:previous?.status || 'Unresolved',reason:previous?.reason || '',problem})
    })
    if (!entries.length || entries.length>500) throw Error('Select a worksheet with 1 to 500 quote lines.')
    const products=[...new Set([...state.products,...state.demand.map(d=>d.product)])]
    $('review').hidden=false
    $('review').innerHTML='<h2>Approve quote lines</h2><p>Choose the exact demand product for each usable SKU. Confirm its fit, units per case and case price. Changed source rows need fresh approval.</p><div class="review-list">'+entries.map((r,i)=>
      '<article class="review-line"><div><strong>'+esc(r.name)+'</strong><small>'+esc(r.id)+' · row '+r.row+'</small></div><div><b>'+ (r.pack ? number(r.pack)+' / case' : 'Pack missing')+'</b><small>'+ (r.price ? money(r.price)+' / case' : 'Price missing')+'</small></div><label>Demand product<select id="product-'+i+'">'+option('','Select product')+products.map(p=>option(p,p)).join('')+'</select></label><label>Decision<select id="decision-'+i+'">'+['Unresolved','Incompatible','Confirm offer'].map(s=>option(s,s)).join('')+'</select></label><small class="line-note">'+esc(r.problem || (r.approved ? 'Exact approval restored' : ''))+'</small></article>').join('')+'</div>'+
      '<p>'+esc(old ? 'Import replaces the active quote for '+id+'. ' : '')+esc(confirmed ? 'Order terms confirmed.' : 'Order terms unresolved. This supplier will be excluded.')+'</p><button class="primary" id="finish">Import reviewed quote</button>'
    $('review').querySelector('p').textContent='A substitute qualifies only after you match its SKU to the requested product and confirm equivalent fit, case count and USD per whole case. Leave uncertain lines unresolved. Record the specification that rules out an incompatible offer.'
    entries.forEach((r,i)=>{
      if(r.revisions.length) $('decision-'+i).closest('article').querySelector('.line-note').textContent='Original source '+money(r.sourcePrice)+' per case · confirmed revision '+money(r.price)+' per case retained.'
      const reason=document.createElement('label')
      reason.className='review-reason'
      reason.innerHTML='Decision note<input maxlength="300" placeholder="e.g. 80 mm lid cannot fit a 90 mm cup">'
      const note=reason.querySelector('input')
      note.value=r.reason
      note.oninput=()=>{r.reason=note.value.trim()}
      $('decision-'+i).closest('article').append(reason)
      $('product-'+i).value=r.product
      $('decision-'+i).value=r.approved ? 'Confirm offer' : r.status==='Incompatible' ? 'Incompatible' : 'Unresolved'
      $('product-'+i).onchange=()=>{$('decision-'+i).value='Unresolved'}
    })
    $('finish').onclick=()=>{
      try {
        for (const [i,r] of entries.entries()) {
          r.product=$('product-'+i).value
          r.status=$('decision-'+i).value
          r.approved=r.status==='Confirm offer'
          if (r.approved && (!r.product || r.problem)) throw Error('Row '+r.row+' needs a valid pack, case price, SKU and demand product to confirm.')
        }
        const source={id,...terms,file:file.name,sheet:sheet.name,headerRow:start,headers,map,rows:entries,imported:new Date().toISOString()}
        source.termsEvidence=sheets.filter(s=>/^terms$/i.test(s.name)).flatMap(s=>s.rows.map((values,i)=>({sheet:s.name,row:i+1,values})))
        const archived=old ? [...(state.archived || []),old] : state.archived || []
        save({...state,archived,suppliers:[...state.suppliers.filter(s=>s.id!==id),source]})
        location.hash='library'
        notify('Imported '+entries.length+' lines from '+id+'.')
      } catch(e) { fail(e) }
    }
    $('review').scrollIntoView({block:'start'})
  }
}
