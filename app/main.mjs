import { $, esc, money, number, option, heading, notify } from './view.mjs'
import { optimize, proofLabel, validRule, validOffer } from './optimizer.mjs'
import { units } from './import-data.mjs'
import { bindDemandIntake, validateDemand } from './demand-intake.mjs'
import { showLibrary, sourceRef, decision } from './quotes.mjs'
import { showPublic } from './public-example.mjs'
import { marketOf, orderBasis } from './scenarios.mjs'
import { sensitivityPanel, bindSensitivity } from './sensitivity.mjs'
import { downloadOrderbook } from './export.mjs'
import { showImport } from './import-ui.mjs'
const key='orderbook.workspace.v1'
const defaults=['Cups · 12 oz','Lids · 90 mm']
let sensitivity
let state
try {
  state=JSON.parse(localStorage.getItem(key)) || {version:1,products:defaults,demand:[{product:defaults[0],units:1200}],suppliers:[]}
  if (state.version!==1 || !Array.isArray(state.suppliers) || !Array.isArray(state.demand) || !Array.isArray(state.products)) throw Error()
  state.allowSplitSourcing=state.allowSplitSourcing===true
} catch {
  $('main').textContent='The saved workspace could not be read. Its browser data has been preserved.'
  throw Error('Unreadable local workspace')
}
function save(next) {
  try { localStorage.setItem(key,JSON.stringify(next)) } catch { throw Error('Local storage is unavailable or full. The previous workspace is still saved.') }
  state=next
}
function render() {
  sensitivity?.stop()
  const page=location.hash.slice(1) || 'compare'
  document.querySelectorAll('nav a').forEach(a=>a.toggleAttribute('aria-current',a.hash==='#'+page))
  if (page==='import') showImport(state,save)
  else if(page==='library') showLibrary(state,save,render,importLink)
  else if(page==='public') showPublic(state,save)
  else compare()
  window.scrollTo(0,0)
}
window.addEventListener('hashchange',render)
const importLink='<a class="button primary" href="#import">Import quote <span aria-hidden="true">↗</span></a>'
function receiptLine(line) {
  const supplier=state.suppliers.find(s=>s.id===line.supplier)
  const source='<p>'+esc(line.id)+' · '+esc(line.name)+'<br>'+esc(sourceRef(supplier,line))+'<br>'+money(line.price)+' per case</p>'
  return '<div class="receipt-row"><div><details><summary>'+esc(line.product)+'</summary>'+source+'</details>'+
    '<small>'+esc(line.supplier)+' · '+esc(line.id)+' · '+number(line.cases)+(line.cases===1?' case × ':' cases × ')+number(line.pack)+' at '+money(line.price)+'</small><small>'+number(line.cases*line.pack)+' received</small></div>'+
    '<div><b>'+money(line.subtotal)+'</b>'+(line.excess===undefined?'':'<small>+'+number(line.excess)+' excess</small>')+'</div></div>'
}
function card(b,i,winner,proven,demand) {
  const tied=b.total===winner.total
  const label=!i ? (proven ? 'Lowest cash basket' : 'Best found') : tied ? 'Equal cash total' : b.orders.length>1 ? 'Multi-supplier order' : 'Single supplier'
  const suppliers=b.orders.map(o=>o.supplier).join(' + ')
  const coverage=state.allowSplitSourcing?'<div class="item-coverage">'+b.items.map(item=>'<small><b>'+esc(item.product)+'</b> · '+number(item.required)+' needed · '+number(item.received)+' received · '+number(item.excess)+' excess</small>').join('')+'</div>':''
  const sourcing=state.allowSplitSourcing?' · '+(b.lines.length>b.items.length?'Split within item':'One SKU per item'):''
  return '<article class="basket '+(!i?'winning':'')+'"><div class="card-head"><div class="basket-label">'+esc(label+sourcing)+'</div><div class="card-price"><h3>'+esc(suppliers)+'</h3><strong>'+money(b.total)+'</strong></div><div class="card-meta"><span>'+b.orders.length+' '+(b.orders.length===1?'delivery':'deliveries')+'</span><span>'+number(b.items.reduce((n,item)=>n+item.excess,0))+' excess units</span></div></div>'+
    '<div class="card-body">'+b.lines.map(receiptLine).join('')+coverage+(b.equalReceipts>1?'<p>'+number(b.equalReceipts)+' equal-cash receipts found for this supplier set. Showing the first in quote order.</p>':'')+
    '<dl><div><dt>Merchandise</dt><dd>'+money(b.merchandise)+'</dd></div>'+b.orders.map(o=>'<div><dt>Delivery · '+esc(o.supplier)+'</dt><dd>'+money(o.fee)+'</dd></div>').join('')+'</dl><details class="order-basis"><summary>Order minimums and delivery</summary>'+b.orders.map(o=>'<p><b>'+esc(o.supplier)+'</b> · '+esc(orderBasis(b,o,demand,state.suppliers.find(s=>s.id===o.supplier)))+'</p>').join('')+'</details><div class="total"><span>Total cash</span><strong>'+money(b.total)+'</strong></div></div></article>'
}
function mountCards(target,result,demand) {
  let shown=0
  const grid=document.createElement('div')
  grid.className='basket-grid'
  const more=document.createElement('button')
  more.className='quiet'
  target.append(grid,more)
  function batch(){
    const end=Math.min(shown+12,result.baskets.length)
    grid.insertAdjacentHTML('beforeend',result.baskets.slice(shown,end).map((b,i)=>card(b,shown+i,result.baskets[0],result.proven,demand)).join(''))
    shown=end
    more.hidden=shown===result.baskets.length
    more.textContent='Show more complete orders ('+(result.baskets.length-shown)+' remaining)'
  }
  more.onclick=batch;batch()
}
function compare() {
  sensitivity?.stop()
  const market=marketOf(state), {offers,demand}=market
  const result=optimize(market)
  const [winner,runner]=result.baskets
  const issues=state.suppliers.flatMap(s=>[...(!validRule(s)?[s.id+' · unresolved order terms']:[]),...s.rows.filter(r=>!r.approved).map(r=>s.id+' / '+r.id+' · '+decision(r))])
  const delta=runner && runner.total-winner.total
  const proof=proofLabel(result)
  const demandBar='<section class="demand-bar"><div><span class="eyebrow">Order demand</span><div class="chips">'+state.demand.map(d=>'<span class="chip">'+esc(d.product)+' <b>'+number(d.units)+'</b></span>').join('')+'</div></div><div><label class="check"><input type="checkbox" id="allowSplit" '+(market.allowSplitSourcing?'checked':'')+'>Allow split sourcing</label><button id="edit" class="quiet">Edit demand</button></div></section><div id="editor"></div>'
  const savings=runner ? '<div class="saving"><span class="saving-icon" aria-hidden="true">↘</span><div><b>'+ (delta ? money(delta)+' cash savings' : 'Equal cash totals')+'</b><span> compared with '+(market.allowSplitSourcing ? money(runner.total)+' for '+(runner.lines.length>runner.items.length?'split sourcing':'one SKU per item')+' from ' : '')+esc(runner.orders.map(o=>o.supplier).join(' + '))+(winner.orders.length<runner.orders.length ? ' · '+(runner.orders.length-winner.orders.length)+' fewer '+(runner.orders.length-winner.orders.length===1?'delivery':'deliveries') : '')+'</span></div></div>' : ''
  const singles=state.suppliers.map(s=>{
    const single=result.baskets.find(b=>b.orders.length===1 && b.orders[0].supplier===s.id)
    const missing=state.demand.filter(d=>!s.rows.some(r=>validOffer(r) && r.product===d.product)).map(d=>d.product)
    const reason=!validRule(s)?'Unresolved order terms':missing.length?'Missing approved '+missing.join(', '):'No complete basket found'
    return '<div class="single"><strong>'+esc(s.id)+'</strong><span>'+esc(single ? 'Complete order' : reason)+'</span><b>'+ (single ? money(single.total) : '—')+'</b></div>'
  }).join('')
  const eligible=offers.filter(o=>validOffer(o) && state.suppliers.some(s=>s.id===o.supplier && validRule(s)))
  const lowerBound=state.demand.reduce((n,d)=>n+eligible.reduce((low,o)=>o.product!==d.product?low:Math.min(low,market.allowSplitSourcing?Math.floor(d.units*o.price/o.pack):Math.ceil(d.units/o.pack)*o.price),Infinity),0)
  const modeRule=market.allowSplitSourcing?'A demand item can combine cases from multiple approved quotes, including different SKUs at one supplier.':'Every demand line uses one approved SKU from one supplier.'
  const demoGuide=state.demo?'<div class="demo-toolbar"><details class="demo-guide"><summary>90-second demo guide</summary><ol><li>Use Inspect quantities to compare 2,100 cups. Leave 1,200 in the saved order.</li><li>Add 1,000 compatible lids to demand, then run the comparison.</li><li>In Quote library, revise Supplier A’s A-12 to $30 per 1,000-cup case. Return here to compare.</li></ol></details><div class="actions"><button id="inspectDemo" class="quiet">Inspect quantities</button>'+(demand[defaults[1]]?'<a class="button quiet" href="#library">Review case prices →</a>':'<button class="quiet" id="addLids">Add compatible lids to demand…</button>')+'</div></div>':''
  $('main').innerHTML=heading('Purchasing workspace','Basket comparison','One destination · One buying period · USD · Zero tax',(state.suppliers.length?'<button class="quiet" id="exportBook">Download XLSX</button>':'')+importLink)+demandBar+demoGuide+
    (state.suppliers.length ? '<section><div class="section-title"><h2>Cash baskets</h2><span class="proof">'+esc(proof)+'</span></div>'+savings+
      (winner ? '<div id="cashOrders"></div>' : '<div class="panel"><h3>'+ (result.proven ? 'No complete basket' : 'No complete basket found yet')+'</h3><p>'+esc(result.missing.length ? 'Missing eligible offers for '+result.missing.join(', ') : 'Review supplier coverage and order terms.')+'</p></div>')+
      '</section><section class="panel singles"><h2>Single-supplier check</h2>'+singles+'</section>' :
      '<section class="panel demo-start"><div class="eyebrow">90-second buying demo</div><h2>Which supplier should ship the cups?</h2><p>Start with 1,200 cups and two reviewed sample quotes. Compare whole cases, add 90 mm lids, then try a revised case price.</p><button id="startDemo" class="primary">Start reviewed cups demo →</button><small>Loads sample quotes and sets demand to 1,200 cups in this browser.</small></section>')+
    (state.suppliers.length?sensitivityPanel:'')+
    (state.suppliers.length?'<details class="panel"><summary>Approved substitutions for this demand</summary><p>Each listed SKU has a buyer-confirmed match for fit, units and USD case price. The comparison can switch between these offers when it prices a complete order.</p>'+state.demand.map(d=>'<p><b>'+esc(d.product)+'</b><br>'+ (eligible.filter(o=>o.product===d.product).map(o=>esc(o.supplier+' / '+o.id+' · '+o.name)+' · '+number(o.pack)+' units for '+money(o.price)).join('<br>') || 'No eligible approved SKU')+'</p>').join('')+'</details>':'')+
    '<div class="notes">'+(issues.length?'<details><summary>'+issues.length+' quote issues excluded</summary>'+issues.map(i=>'<p>'+esc(i)+'</p>').join('')+'</details>':'')+
    '<details><summary>Buying rules and search bounds</summary><p>'+modeRule+' Order whole cases. Extra cases can satisfy a merchandise minimum or earn free delivery. Each used supplier charges its fee once. Both thresholds include equality. Tax is zero.</p><p>For each supplier combination, keep the cheapest complete order found. With split sourcing enabled, keep separate alternatives for mixed and single-SKU items. Equal cash totals share rank. Fewer deliveries sort first, then the first receipt found. Search limit 100,000 nodes.</p><p>'+number(result.nodes)+' nodes visited'+(Number.isFinite(lowerBound)?' · merchandise lower bound '+money(lowerBound):'')+(winner?' · feasible upper bound '+money(winner.total):'')+'.</p></details></div>'
  if(winner) mountCards($('cashOrders'),result,demand)
  $('edit').onclick=()=>editDemand()
  $('allowSplit').onchange=e=>{
    try { save({...state,allowSplitSourcing:e.target.checked});compare() }
    catch(error){e.target.checked=market.allowSplitSourcing;notify(error.message)}
  }
  if($('inspectDemo')) $('inspectDemo').onclick=()=>{const panel=$('sensitivity');panel.open=true;panel.scrollIntoView({block:'start'})}
  if($('addLids')) $('addLids').onclick=()=>editDemand(true)
  if($('startDemo')) $('startDemo').onclick=async e=>{
    const button=e.currentTarget
    button.disabled=true
    try {
      const response=await fetch('/samples/reviewed-demo.json')
      if(!response.ok) throw Error('Reviewed sample unavailable.')
      const {suppliers}=await response.json()
      if(!button.isConnected) return
      save({...state,suppliers,demand:[{product:defaults[0],units:1200}],products:[...new Set([...state.products,...defaults])],demo:true})
      compare();notify('Reviewed sample quotes loaded.')
    } catch(error){button.disabled=false;notify(error.message)}
  }
  if($('sensitivity')) sensitivity=bindSensitivity(market,mountCards,(item,q)=>{
    try {
      save({...state,demand:state.demand.map(d=>d.product===item?{...d,units:q}:d)})
      compare();notify('Scenario quantity applied.')
    } catch(error){notify(error.message)}
  })
  if($('exportBook')) $('exportBook').onclick=async e=>{
    const button=e.currentTarget
    button.disabled=true;button.textContent='Preparing workbook…'
    try {await downloadOrderbook(state,market,result,sensitivity?.range());notify('Comparison workbook downloaded.')}
    catch(error){notify('Export failed. '+error.message)}
    finally {button.disabled=false;button.textContent='Download XLSX'}
  }
}
function editDemand(withLids=false) {
  const wrap=$('editor')
  wrap.innerHTML='<form class="panel" id="demandForm"><h2>Edit order demand</h2><div id="demandRows"></div><datalist id="products">'+state.products.map(p=>option(p,p)).join('')+'</datalist><button class="quiet" id="addLine" type="button">+ Add item</button><div class="sample-links"><a download href="/samples/demand-template.csv">Demand template · CSV ↓</a><label class="file-btn">Load demand CSV or XLSX<input type="file" id="demandFile" accept=".csv,.xlsx"></label></div><div id="demandMapping"></div><p role="alert" class="error" id="demandError"></p><div class="actions"><button type="submit" class="primary">Run comparison</button><button class="quiet" type="button" id="cancel">Cancel</button></div></form>'
  const sources=new WeakMap()
  function add(product='',qty='',source) {
    const row=document.createElement('div')
    row.className='demand-row'
    row.innerHTML='<label>Demand product<input name="product" required list="products" maxlength="140" value="'+esc(product)+'"></label><label>Units needed<input name="units" required inputmode="numeric" value="'+esc(qty)+'"></label><button type="button" aria-label="Remove item" class="quiet">×</button>'
    row.querySelector('button').onclick=()=>row.remove()
    if(source) {
      sources.set(row,source)
      const note=document.createElement('small')
      note.textContent='Original demand · '+source.file+' · '+source.sheet+' · row '+source.row+' · '+source.product+' · '+source.units+' units'
      row.append(note)
    }
    $('demandRows').append(row)
  }
  state.demand.forEach(d=>add(d.product,d.units,d.source))
  if(withLids) add(defaults[1],1000)
  $('addLine').onclick=()=>add()
  $('cancel').onclick=()=>wrap.replaceChildren()
  bindDemandIntake($('demandForm'),rows=>{
    $('demandRows').replaceChildren()
    rows.forEach(d=>add(d.product,d.units,d.source))
  })
  $('demandForm').onsubmit=e=>{
    e.preventDefault()
    try {
      if ($('demandForm').querySelector('[type=submit]').disabled) return
      const rows=Array.from(wrap.querySelectorAll('.demand-row')).map(el=>({product:el.querySelector('[name=product]').value.trim(),units:units(el.querySelector('[name=units]').value),source:sources.get(el)}))
      validateDemand(rows)
      const names=rows.map(d=>d.product)
      save({...state,demand:rows,products:[...new Set([...state.products,...names])]})
      compare(); notify('Demand saved and comparison updated.')
    } catch(e) { $('demandError').textContent=e.message }
  }
  wrap.querySelector('input').focus()
}
render()
