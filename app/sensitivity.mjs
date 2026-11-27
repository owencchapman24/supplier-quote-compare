import { $, esc, money, number, option } from './view.mjs'
import { units } from './import-data.mjs'
import { proofLabel } from './optimizer.mjs'

export function scenarioJob(data) {
  const worker=new Worker('/app/scenario-worker.mjs',{type:'module'})
  const promise=new Promise((resolve,reject)=>{
    worker.onmessage=({data})=>{worker.terminate();data.error?reject(Error(data.error)):resolve(data.value)}
    worker.onerror=e=>{worker.terminate();reject(Error(e.message))}
  })
  worker.postMessage(data)
  return {promise,cancel:()=>worker.terminate()}
}
export const sensitivityPanel='<details class="panel sensitivity" id="sensitivity"><summary>Quantity sensitivity</summary><p>Vary one required item. Other quantities stay fixed. Select an interval to inspect competing complete orders.</p><div id="scenarioControls"></div></details>'
export function bindSensitivity(market,renderCards,apply) {
  let scan,probe,currentRange
  const panel=$('sensitivity')
  panel.ontoggle=()=>{
    if(!panel.open || $('scenarioItem')) return
    $('scenarioControls').innerHTML=`<div class="field-row"><label>Required item<select id="scenarioItem">${Object.keys(market.demand).map(p=>option(p,p)).join('')}</select></label><label>Range from<input id="rangeStart" value="1"></label><label>Through quantity<input id="rangeEnd"></label><button class="quiet" id="runRange">Find intervals</button></div>
      <div id="ranges" aria-live="polite"></div><div class="field-row"><label>Inspect quantity<input inputmode="numeric" id="probeQty"></label><button class="quiet" id="inspect">Compare at quantity</button></div><div id="probeResult" aria-live="polite"></div>`
    function product(){return $('scenarioItem').value}
    async function inspect() {
      probe?.cancel()
      const item=product(), quantity=units($('probeQty').value), dest=$('probeResult')
      if(!quantity) {dest.textContent='Enter a whole quantity from 1 to 1,000,000.';return}
      dest.textContent='Pricing complete orders…'
      probe=scenarioJob({market,product:item,quantity})
      try {
        const r=await probe.promise
        dest.innerHTML='<h3>'+number(quantity)+' units · '+esc(item)+'</h3><p>'+esc(proofLabel(r))+' · '+number(r.nodes)+' nodes</p>'+
          (r.baskets.length?'<div class="scenario-cards"></div>':'<p>No complete order found.</p>')+
          '<button class="primary" id="applyScenario">Apply '+number(quantity)+' to order demand</button>'
        if(r.baskets.length) renderCards(dest.querySelector('.scenario-cards'),r,{...market.demand,[item]:quantity})
        dest.querySelector('button#applyScenario').onclick=()=>apply(item,quantity)
      } catch(e){dest.textContent=e.message}
    }
    async function range(start=units($('rangeStart').value)) {
      scan?.cancel();currentRange=null
      const item=product(), end=units($('rangeEnd').value), dest=$('ranges')
      if(!start || !end || start>end){dest.textContent='Enter an increasing range of whole quantities from 1 to 1,000,000.';return}
      dest.textContent='Checking whole-case boundaries…'
      scan=scenarioJob({market,product:item,start,end})
      try {
        const result=await scan.promise
        currentRange=result
        dest.innerHTML='<p>'+number(result.start)+'–'+number(result.groups.at(-1).end)+' inspected · '+number(result.events)+(market.allowSplitSourcing?' quantities':' case intervals')+' · '+number(result.nodes)+' search nodes. Page limits are 128 checks and 400,000 nodes. Each row groups the same recommended SKUs and case counts.</p>'+
          '<div class="interval-list">'+result.groups.map(g=>'<div><button class="interval" data-q="'+g.start+'"><b>'+number(g.start)+'–'+number(g.end)+'</b><span>'+esc(g.orders)+'</span><strong>'+(g.total===null?'—':money(g.total))+(g.proven?'':' · '+esc(g.proof))+'</strong></button><details><summary>Why this interval</summary><p>'+esc(g.why)+' '+esc(g.proof)+'.</p></details></div>').join('')+'</div>'+
          (result.next?'<p>Page limit reached. Quantities from '+number(result.next)+' are still unchecked.</p><button id="nextRange" class="quiet">Inspect next page</button>':'')
        dest.querySelectorAll('.interval').forEach(b=>b.onclick=()=>{$('probeQty').value=b.dataset.q;inspect()})
        if(result.next) $('nextRange').onclick=()=>{$('rangeStart').value=result.next;range(result.next)}
      } catch(e){dest.textContent=e.message}
    }
    function reset(){
      const q=market.demand[product()]
      $('probeQty').value=q;$('rangeStart').value=1;$('rangeEnd').value=Math.max(3000,q)
      range();inspect()
    }
    $('scenarioItem').onchange=reset
    $('runRange').onclick=()=>range()
    $('inspect').onclick=inspect
    $('probeQty').oninput=()=>{probe?.cancel();$('probeResult').replaceChildren()}
    reset()
  }
  return {stop(){scan?.cancel();probe?.cancel()},range:()=>currentRange}
}
