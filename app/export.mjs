import { writeBook, usd, computed } from './xlsx.mjs'
import { decision, original, sourceRef } from './quotes.mjs'
import { orderBasis } from './scenarios.mjs'
import { scenarioJob } from './sensitivity.mjs'
import { proofLabel, validRule } from './optimizer.mjs'
import { demandBasis } from './demand-intake.mjs'

export async function downloadOrderbook(state,market,result,selectedRange) {
  const sheets=[]
  function sheet(name,headers,widths) {
    const rows=[]
    sheets.push({name,headers,widths,rows})
    return rows
  }
  const orders=sheet('Order by supplier',['Plan','Supplier','Record','SKU','Quoted product','Demand match','Required units','Cases','Units per case','Received','Excess','USD per case','Merchandise','Delivery','Source file','Worksheet','Row','Order terms and top-ups','Delivered order cost'],[12,22,18,18,34,25,16,10,15,13,12,16,17,15,27,21,10,55,21])
  const compare=sheet('Plan comparison',['Plan','Status','Supplier combination','Merchandise','Delivery','Total cash','Deliveries','Excess units','Search scope'],[12,26,40,18,16,18,14,16,57])
  const detail=sheet('All plan orders',sheets[0].headers,sheets[0].widths)
  const sources=new Map(state.suppliers.map(s=>[s.id,s]))
  const split=market.allowSplitSourcing
  if(split) {
    sheets[0].headers.push('Combined received','Demand item number')
    sheets[0].widths.push(20,20)
  }
  const itemNumbers=new Map(state.demand.map((d,i)=>[d.product,i+1]))
  const termRows=new Map(state.suppliers.map((s,i)=>[s.id,state.demand.length+i+2]))
  function receipt(rows,b,plan) {
    const start=rows.length+2
    for(const o of b.orders) {
      const s=sources.get(o.supplier)
      const first=rows.length+2
      for(const l of b.lines.filter(l=>l.supplier===o.supplier)){
        const i=rows.length+2
        const row=[plan,s.id,'Order line',l.id,l.name,l.product,split?null:market.demand[l.product],l.cases,l.pack,computed(l.received,'H'+i+'*I'+i),split?null:computed(l.excess,'J'+i+'-G'+i),usd(l.price),computed(l.subtotal/100,'ROUND(H'+i+'*L'+i+',2)',true),null,s.file,s.sheet,l.row]
        if(split) row[20]=itemNumbers.get(l.product)
        rows.push(row)
      }
      const terms=s.termsEvidence?.find(t=>t.values[0]==='Delivery per order' && Number(t.values[1])*100===s.fee)
      const last=rows.length+2
      const goods='ROUND(SUM(M'+first+':M'+(last-1)+'),2)'
      const term="'Demand and terms'!", termRow=termRows.get(s.id)
      const feeFormula='IF(AND(ISNUMBER('+term+'F'+termRow+'),'+goods+'>='+term+'F'+termRow+'),0,'+term+'D'+termRow+')'
      rows.push([plan,s.id,'Order delivery',null,null,null,null,null,null,null,null,null,null,computed(o.fee/100,feeFormula,true),s.file,terms?.sheet,terms?.row,orderBasis(b,o,market.demand,s),computed((o.merchandise+o.fee)/100,goods+'+N'+last,true)])
    }
    const lastLine=rows.length+1
    if(split) for(const item of b.items) {
      const i=rows.length+2, itemNumber=itemNumbers.get(item.product)
      const row=[plan,null,'Item coverage',null,null,item.product,computed(item.required,"'Demand and terms'!C"+(itemNumber+1)),null,null,null,computed(item.excess,'T'+i+'-G'+i)]
      row[19]=computed(item.received,'SUMIF(U'+start+':U'+lastLine+',U'+i+',J'+start+':J'+lastLine+')')
      row[20]=itemNumber
      rows.push(row)
    }
  }
  result.baskets.forEach((b,i)=>{
    const id='Plan '+(i+1), lowest=b.total===result.baskets[0].total
    if(i===0) receipt(orders,b,id)
    const first=detail.length+2
    receipt(detail,b,id)
    const sum=col=>"SUM('All plan orders'!"+col+first+':'+col+(detail.length+1)+')'
    compare.push([id,lowest?proofLabel(result):'Alternative',b.orders.map(o=>o.supplier).join(' + '),computed(b.merchandise/100,sum('M'),true),computed(b.fees/100,sum('N'),true),computed(b.total/100,'ROUND(D'+(i+2)+'+E'+(i+2)+',2)',true),b.orders.length,computed(b.items.reduce((v,item)=>v+item.excess,0),sum('K')),(b.lines.length>b.items.length?'Split within item. ':'One SKU per item. ')+'Cheapest found for this sourcing pattern and supplier combination. Equal cash totals share rank.'+(b.equalReceipts>1?' First of '+b.equalReceipts+' equal-cost receipts found for this combination.':'')])
  })
  if(!result.baskets.length) compare.push(['—',result.proven?'No complete order found':proofLabel(result),result.missing.join(', ')])
  const bounds=sheet('Quantity boundaries',['Required item','From units','Through units','Recommended orders and cases','Cash','Proof','Reason at first quantity','Source locations','Requested range / coverage'],[25,16,16,52,16,23,85,55,48])
  for(const d of state.demand){
    const scan=selectedRange?.product===d.product?selectedRange:await scenarioJob({market,product:d.product,start:1,end:Math.max(3000,d.units)}).promise
    for(const g of scan.groups) bounds.push([d.product,g.start,g.end,g.orders,usd(g.total),g.proof,g.why,g.refs.map(l=>sourceRef(sources.get(l.supplier),l)).join('\n'),scan.start+'–'+scan.end+(scan.next?' · unchecked from '+scan.next:' · complete coverage')])
  }
  const demand=sheet('Demand and terms',['Record','Item or supplier','Units required','Order fee','Merchandise minimum','Free freight from','Status / basis','Source file','Worksheet','Source row','Original product','Original units'],[23,32,18,15,22,20,65,28,22,13,32,17])
  for(const d of state.demand) {
    const s=d.source
    demand.push(['Demand',d.product,d.units,null,null,null,demandBasis(d),s?.file,s?.sheet,s?.row,s?.product,s?.units])
  }
  for(const s of state.suppliers) demand.push(['Supplier terms',s.id,null,usd(s.fee),usd(s.minimum),usd(s.freeAt),validRule(s)?'Confirmed for one order'+(s.freeAt===null?' · no free-freight threshold':''):'Unresolved · excluded'])
  demand.push(['Search',null,null,null,null,null,proofLabel(result)+' · '+result.nodes+' nodes · 100,000 maximum per basket search. Allow split sourcing '+(split?'on':'off')+'. USD, zero tax, one destination and buying period.'])
  const quotes=sheet('Quote decisions',['Version','Supplier','Imported at','SKU','Source description','Demand product','Units per case','Original case price','Current case price','Review decision and reason','Source file','Worksheet','Row'],[16,24,28,18,36,26,17,19,19,50,29,22,10])
  const raw=sheet('Source records',['Version','Supplier','Imported at','Source file','Worksheet','Row','Source column','Source heading','Raw cell value'],[17,22,28,27,22,11,17,32,61])
  const history=sheet('Price revisions',['Version','Supplier','SKU','Prior price','Revised price','Revised at','Buyer citation','Confirmed basis','Source row'],[16,22,17,17,17,28,46,43,45])
  function sourceRows(s,version) {
    for(const r of s.rows){
      quotes.push([version,s.id,s.imported,r.id,r.name,r.product,r.pack,usd(original(r)),usd(r.price),decision(r),s.file,s.sheet,r.row])
      r.raw.forEach((v,i)=>raw.push([version,s.id,s.imported,s.file,s.sheet,r.row,i+1,s.headers[i],v]))
      for(const rev of r.revisions || []) history.push([version,s.id,r.id,usd(rev.from),usd(rev.to),rev.at,rev.note,r.product+' · USD per '+r.pack+' units',sourceRef(s,r)])
    }
    for(const term of s.termsEvidence || []) term.values.forEach((v,i)=>raw.push([version,s.id,s.imported,s.file,term.sheet,term.row,i+1,'Order terms worksheet',v]))
  }
  state.suppliers.forEach(s=>sourceRows(s,'Active'))
  ;(state.archived || []).forEach(s=>sourceRows(s,'Superseded'))
  const issues=sheet('Unresolved items',['Issue','Supplier','SKU or demand','Description','Decision or missing information','Source file','Worksheet','Row'],[24,24,24,42,68,30,23,12])
  for(const product of result.missing) {
    issues.push(['Unfilled demand',null,product,null,'No approved offer with a valid pack, case price and confirmed supplier terms.'])
  }
  for(const supplier of state.suppliers) {
    if (!validRule(supplier)) issues.push(['Unconfirmed terms',supplier.id,null,null,'Confirm the order fee, merchandise minimum and free-delivery terms.',supplier.file,supplier.sheet])
    for(const row of supplier.rows.filter(r=>!r.approved)) {
      issues.push([row.status==='Incompatible'?'Incompatible offer':'Unresolved offer',supplier.id,row.id,row.name,decision(row),supplier.file,supplier.sheet,row.row])
    }
  }
  if (!issues.length) issues.push(['No unresolved items'])
  const blob=await writeBook(sheets)
  const href=URL.createObjectURL(blob), a=document.createElement('a')
  a.href=href;a.download='Orderbook-comparison.xlsx';document.body.append(a);a.click();a.remove()
  setTimeout(()=>URL.revokeObjectURL(href),60000)
}
