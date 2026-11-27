import { $, esc, money, number, heading, notify } from './view.mjs'
import { validRule } from './optimizer.mjs'
import { cents } from './import-data.mjs'

export const sourceRef=(s,r)=>s.file+' · '+s.sheet+' · row '+r.row
export const decision=r=>r.approved ? 'Approved equivalent · '+r.product :
  [r.status || 'Unresolved',r.reason || (r.status==='Incompatible' ? (r.name+' does not meet '+(r.product || 'the requested specification')) : ''),r.problem].filter(Boolean).join(' · ')
export const original=r=>r.sourcePrice===undefined ? r.price : r.sourcePrice
const priceText=value=>value==null?'—':money(value)

export function showLibrary(state,save,refresh,importLink) {
  const sections=state.suppliers.map((s,si)=>{
    const rows=s.rows.map((r,ri)=>`<tr><td><strong>${esc(r.name)}</strong><small>${esc(r.id)} · row ${r.row}</small></td>
      <td>${esc(r.product || '—')}</td><td>${esc(r.pack ?? '—')}</td><td>${priceText(r.price)}
      ${r.revisions?.length ? '<small>Source '+priceText(original(r))+'</small>' : ''}
      ${r.approved ? '<button class="text-button revise" data-s="'+si+'" data-r="'+ri+'">Revise price</button>' : ''}</td>
      <td>${esc(decision(r))}</td></tr>`).join('')
    const records=s.rows.map(r=>'<p><b>'+esc(sourceRef(s,r))+'</b><br>'+r.raw.map((v,i)=>esc(s.headers[i])+' = '+esc(v)).join(' · ')+(r.revisions || []).map(v=>'<br>Buyer revision · '+esc(v.at)+' · '+money(v.from)+' → '+money(v.to)+' per case · '+esc(v.note)).join('')+'</p>').join('')
    return `<section class="panel"><div class="section-title"><h2>${esc(s.id)}</h2><span class="pill">${validRule(s)?'Terms confirmed':'Terms unresolved'}</span></div>
      <p>${esc(s.file+' / '+s.sheet)} · imported ${esc(new Date(s.imported).toLocaleString())}</p><p>${validRule(s)?'Delivery '+money(s.fee)+' per order · minimum '+money(s.minimum)+' · '+(s.freeAt===null?'no free-freight threshold':'free freight from '+money(s.freeAt)):'Confirm order terms on reimport to enable ranking.'}</p>
      <div class="table-scroll"><table><thead><tr><th>Source offer</th><th>Demand match</th><th>Units / case</th><th>Current case price</th><th>Buyer decision</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div id="revision-${si}"></div><details><summary>Source records and column map</summary><p>${Object.entries(s.map).map(([k,col])=>esc(k)+' → '+esc(s.headers[col])).join(' · ')}</p>${records}</details></section>`
  })
  const archive=(state.archived || []).map(s=>'<details><summary>'+esc(s.id+' · '+s.file+' · '+s.imported)+'</summary>'+s.rows.map(r=>'<p>'+esc(sourceRef(s,r)+' · '+r.id)+' · '+priceText(r.price)+' · '+esc(decision(r))+'</p>').join('')+'</details>').join('')
  $('main').innerHTML=heading('Sourcing workspace','Quote library','Approved equivalents, case prices and their source records.',importLink)+
    (sections.join('') || '<section class="panel empty"><h2>Your quote library is empty</h2><p>Import a supplier file or open the reviewed sample in Comparison.</p>'+importLink+'</section>')+
    (archive?'<section class="panel"><h2>Superseded imports</h2>'+archive+'</section>':'')
  document.querySelectorAll('.revise').forEach(button=>button.onclick=()=>{
    const si=Number(button.dataset.s), ri=Number(button.dataset.r), supplier=state.suppliers[si], row=supplier.rows[ri]
    const target=$('revision-'+si)
    target.innerHTML=`<form class="revision"><h3>Revise ${esc(row.id)} case price</h3><p>${esc(sourceRef(supplier,row))} · source ${priceText(original(row))} · current ${money(row.price)}</p>
      <div class="field-row"><label>New case price (USD)<input required name="price" inputmode="decimal" value="${(row.price/100).toFixed(2)}"></label><label>Revision source or note<input required maxlength="300" name="note" placeholder="e.g. Supplier’s revised case quote"></label></div>
      <label class="check"><input type="checkbox" required>I confirm ${esc(row.id)} meets ${esc(row.product)} and the new USD price buys one case of ${number(row.pack)} units.</label>
      <p class="error" role="alert"></p><div class="actions"><button class="primary">Save revision</button><button class="quiet" type="button">Cancel</button></div></form>`
    const form=target.firstElementChild
    form.elements.price.select()
    form.querySelector('[type=button]').onclick=()=>target.replaceChildren()
    form.onsubmit=e=>{
      e.preventDefault()
      try {
        const to=cents(form.elements.price.value), note=form.elements.note.value.trim()
        if(!to || to===row.price || !note) throw Error('Enter a different positive case price and its source.')
        const revised={...row,sourcePrice:original(row),price:to,revisions:[...(row.revisions || []),{from:row.price,to,note,at:new Date().toISOString()}]}
        save({...state,suppliers:state.suppliers.map((s,i)=>i===si?{...s,rows:s.rows.map((r,j)=>j===ri?revised:r)}:s)})
        refresh(); notify('Revised '+row.id+' to '+money(to)+' per case.')
      } catch(error) {form.querySelector('.error').textContent=error.message}
    }
  })
}
