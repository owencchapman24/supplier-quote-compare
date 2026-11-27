import { optimize, proofLabel, validOffer, validRule, validUnits } from './optimizer.mjs'
import { money, number } from './view.mjs'

export const marketOf=state=>({
  allowSplitSourcing:state.allowSplitSourcing===true,
  suppliers:state.suppliers.map(({id,fee,minimum,freeAt})=>({id,fee,minimum,freeAt})),
  offers:state.suppliers.flatMap(s=>s.rows.map(({id,name,product,pack,price,approved,supplier,row})=>({id,name,product,pack,price,approved,supplier,row}))),
  demand:Object.fromEntries(state.demand.map(d=>[d.product,d.units]))
})
export const caseLabel=b=>b.lines.map(l=>l.supplier+' '+l.id+' × '+number(l.cases)).join(' + ')
export function orderBasis(b,order,demand,rule) {
  const lines=b.lines.filter(l=>l.supplier===order.supplier)
  if (b.lines.length>b.items.length) {
    return lines.map(l=>l.id+' × '+number(l.cases)+' at '+money(l.price)).join(' + ')+
      ' = '+money(order.merchandise)+' merchandise. Minimum '+money(rule.minimum)+' met. Delivery '+money(order.fee)+
      (rule.freeAt!==null?' (free from '+money(rule.freeAt)+')':'')+'.'
  }
  const raw=lines.reduce((sum,l)=>sum+Math.ceil(demand[l.product]/l.pack)*l.price,0)
  const extra=lines.reduce((sum,l)=>sum+l.cases-Math.ceil(demand[l.product]/l.pack),0)
  return 'Demand-only merchandise '+money(raw)+(raw<rule.minimum?' falls below the '+money(rule.minimum)+' minimum':' meets the '+money(rule.minimum)+' minimum')+
    (extra?'. Added '+number(extra)+' whole '+(extra===1?'case':'cases')+' → '+money(order.merchandise)+' valid merchandise':'')+
    '. Delivery '+money(order.fee)+(rule.freeAt!==null?' (free from '+money(rule.freeAt)+')':'')+'.'
}
const best=r=>r.baskets.filter(b=>b.total===r.baskets[0].total)
const receiptKey=b=>JSON.stringify(b.lines.map(l=>[l.product,l.supplier,l.row,l.id,l.pack,l.price,l.cases]))
function changeText(prev,current,product,q,split) {
  const explain=(b,quantity)=>caseLabel(b)+' · '+money(b.merchandise)+' goods + '+money(b.fees)+' delivery = '+money(b.total)+' · '+number(b.items.find(i=>i.product===product).received-quantity)+' extra on this item'
  if(!current.baskets.length) return current.missing.length?'No eligible offer for '+current.missing.join(', '):'No complete order found within the search.'
  const alternative=current.baskets.find(b=>b.total>current.baskets[0].total)
  const comparison=alternative?' The next displayed alternative at '+number(q)+' units costs '+money(alternative.total)+' ('+caseLabel(alternative)+', including '+money(alternative.fees)+' delivery).':''
  if(!prev?.baskets.length) return 'At '+number(q)+' units: '+best(current).map(b=>explain(b,q)).join(' / ')+'.'+comparison
  const changes=[]
  if (!split) for(const b of prev.baskets) {
    const old=b.lines.find(l=>l.product===product)
    if((q-1)%old.pack===0) changes.push(old.id+' now needs at least '+number(Math.ceil(q/old.pack))+' cases, up from '+number((q-1)/old.pack)+' ('+number(old.pack)+' units at '+money(old.price)+' per case)')
  }
  return [...new Set(changes)].join('; ')+(changes.length?'. ':'')+number(q-1)+' units: '+best(prev).map(b=>explain(b,q-1)).join(' / ')+'. '+number(q)+' units: '+best(current).map(b=>explain(b,q)).join(' / ')+'.'+comparison
}

// The feasible case counts for every assignment stay constant until some
// eligible SKU's ceil(quantity / pack) changes. Top-up and fee rules depend
// only on those counts and merchandise. Jump directly to the next event.
export function scanRange(market,product,start,end,{maxEvents=128,maxNodes=400000,perScenario=100000}={}) {
  if(!Object.hasOwn(market.demand,product) || !validUnits(start) || !validUnits(end) || end<start) throw Error('Choose a required item and a range from 1 to 1,000,000.')
  const eligible=new Set(market.suppliers.filter(validRule).map(s=>s.id))
  const packs=[...new Set(market.offers.filter(o=>o.product===product && validOffer(o) && eligible.has(o.supplier)).map(o=>o.pack))]
  const solve=(q,budget)=>optimize({...market,demand:{...market.demand,[product]:q}},{maxNodes:budget})
  let q=start, events=0, nodes=0, previous=null
  const groups=[]
  while(q<=end && events<maxEvents && nodes<maxNodes) {
    const result=solve(q,Math.min(perScenario,maxNodes-nodes))
    nodes+=result.nodes; events++
    // Mixed pack sums introduce additional boundaries. Inspect every integer.
    const last=market.allowSplitSourcing?q:packs.reduce((n,pack)=>Math.min(n,Math.ceil(q/pack)*pack),end)
    const winners=best(result)
    const key=JSON.stringify([result.proven,winners.map(receiptKey)])
    const tail=groups.at(-1)
    if(tail && tail.key===key && result.proven) tail.end=last
    else {
      const refs=new Map()
      for(const b of [...(previous?best(previous):[]),...winners,...result.baskets.slice(winners.length,winners.length+1)]) {
        for(const {supplier,row} of b.lines) refs.set(JSON.stringify([supplier,row]),{supplier,row})
      }
      groups.push({key,start:q,end:last,proven:result.proven,proof:proofLabel(result),total:winners[0]?.total ?? null,
        orders:winners.map(caseLabel).join(' OR ') || 'No complete order',refs:[...refs.values()],why:changeText(previous,result,product,q,market.allowSplitSourcing)})
    }
    previous=result
    q=last+1
  }
  return {product,start,end,groups:groups.map(({key,...g})=>g),events,nodes,next:q<=end?q:null}
}
