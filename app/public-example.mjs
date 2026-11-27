import { $, esc, money, option, heading } from './view.mjs'
import { optimize } from './optimizer.mjs'

export async function showPublic(state,save) {
  const root=$('main')
  root.innerHTML=heading('Historical bid tab','Frozen pizza comparison','Reading the local bid record…')
  const marker=root.firstElementChild
  try {
    const base='/evidence/public-source/'
    const response=await fetch(base+'item-34893.json')
    if(!response.ok) throw Error('Historical source unavailable.')
    const {source,offers,illustration}=await response.json()
    if(!marker.isConnected) return
    const approvals={...state.publicApprovals}
    const product='Pizza servings', qty=illustration.demand
    const rates=o=>[{cents:o.manufacturerIngredientsCents,basis:'Manufacturer-supplied ingredients'},...o.conditionalPrices]
    root.innerHTML=heading('Historical bid tab · Item '+source.item,'Frozen pizza comparison','Montgomery County Public Schools · April 16, 2021 · Frozen Pizza, request 9111, cycle 7')+
      `<section class="panel source-intro"><div><h2>What the bid requested</h2><p>${source.requestedPack} portions per case · ${esc(source.requestedShape)} · ${esc(source.deliveryBasis)}. Contract period July 2021–June 2023.</p><div class="sample-links"><a href="${esc(source.url)}" target="_blank" rel="noopener">Official MCPS bid tab, page ${source.page} &#8599;</a></div></div></section>
      <section class="panel"><h2>Test a 140-serving purchase</h2><p>This separate, fictional order assumes zero freight and tax, one serving per quoted piece, and feasible truckload delivery. Review pack and shape for each SKU and confirm the ingredient or wrapping condition for the selected rate.</p>
      <div class="historical-grid">${offers.map((o,i)=>`<form class="source-offer"><h3>${esc(o.supplier)}</h3><small>${esc(o.sku)} · ${o.pack} ${esc(o.unit)} / case</small><p>${esc(o.confirm)}</p>
      <div class="rate-math">${rates(o).map(r=>'<p>'+esc(r.basis)+'<br><b>'+Math.ceil(qty/o.pack)+' cases × '+money(r.cents)+' = '+money(Math.ceil(qty/o.pack)*r.cents)+'</b></p>').join('')}</div>
      <label>Price basis<select>${rates(o).map((r,j)=>option(j,r.basis+' · '+money(r.cents))).join('')}</select></label>
      <label class="check"><input type="checkbox">I accept this pack, specification and price basis.</label><button class="quiet">Save decision</button><small id="status-${i}"></small></form>`).join('')}</div></section><section id="historical-result" class="panel" aria-live="polite"></section>`
    function results() {
      const suppliers=offers.map(o=>({id:o.supplier,fee:illustration.freightCents,freeAt:null,minimum:0}))
      const rows=offers.map((o,i)=>{
        const rate=rates(o)[approvals[o.sku]]
        $('status-'+i).textContent=rate?'Included · '+rate.basis:'Excluded pending buyer confirmation'
        return {supplier:o.supplier,id:o.sku,product,pack:o.pack,price:rate?.cents,approved:!!rate}
      })
      const {baskets}=optimize({suppliers,offers:rows,demand:{[product]:qty}})
      $('historical-result').innerHTML='<h2>Eligible historical orders</h2>'+(baskets.length?baskets.map(b=>{
        const l=b.lines[0]
        return '<p><b>'+esc(l.supplier)+' · '+money(b.total)+'</b> · '+esc(l.id)+' · '+l.cases+' cases at '+money(l.price)+' · '+l.cases*l.pack+' received · '+l.excess+' excess · delivery '+money(b.fees)+(b.total===baskets[0].total?' · Lowest eligible cash':'')+'</p>'
      }).join(''):'<p>Confirm at least one offer to calculate eligible orders.</p>')
    }
    root.querySelectorAll('.source-offer').forEach((form,i)=>{
      const o=offers[i],select=form.querySelector('select'),check=form.querySelector('input')
      if(Object.hasOwn(approvals,o.sku)){select.value=approvals[o.sku];check.checked=true}
      select.onchange=()=>{check.checked=false;$('status-'+i).textContent='Unsaved basis · confirm and save to update the comparison.'}
      form.onsubmit=e=>{
        e.preventDefault()
        const next={...approvals}
        if(check.checked) next[o.sku]=Number(select.value)
        else delete next[o.sku]
        try {save({...state,publicApprovals:next});delete approvals[o.sku];Object.assign(approvals,next);results()}
        catch(error){$('status-'+i).textContent=error.message}
      }
    })
    results()
  } catch(error){if(marker.isConnected) marker.textContent=error.message}
}
