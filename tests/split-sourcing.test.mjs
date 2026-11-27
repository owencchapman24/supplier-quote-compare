import test from 'node:test'
import assert from 'node:assert/strict'
import { optimize, proofLabel } from '../app/optimizer.mjs'
import { scanRange } from '../app/scenarios.mjs'

const rule = (id, fee = 0, minimum = 0, freeAt = null) => ({ id, fee, minimum, freeAt })
const quote = (supplier, product, id, pack, price, approved = true) => ({ supplier, product, id, pack, price, approved })
const demo = {
  suppliers: [rule('A'), rule('B', 3500)],
  offers: [quote('A','cups','A12',1000,4800), quote('B','cups','B12',750,3300),
    quote('B','lids','B90',1000,4000), quote('A','lids','wrong rim',1000,1,false)],
  demand: { cups: 1750, lids: 1000 }, allowSplitSourcing: true
}

// Independent cash register. The fixture domain has demand and thresholds <= 5
// and prices/packs >= 1. Six of any SKU already cover every requirement.
// Enumerate each count vector directly, without solver bounds or pruning.
function enumerate(market) {
  const best = new Map()
  for (let code = 0; code < 7 ** market.offers.length; code++) {
    let digits = code, valid = true
    const received = new Map(), spent = new Map(), products = new Set()
    let mixed = false
    for (const o of market.offers) {
      const count = digits % 7
      digits = Math.floor(digits / 7)
      if (!count) continue
      if (!o.approved || !o.pack) { valid = false; break }
      mixed ||= products.has(o.product)
      products.add(o.product)
      received.set(o.product, (received.get(o.product) || 0) + count * o.pack)
      spent.set(o.supplier, (spent.get(o.supplier) || 0) + count * o.price)
    }
    if (!valid || Object.entries(market.demand).some(([p,q]) => !(received.get(p) >= q))) continue
    let cash = 0
    for (const [id, goods] of spent) {
      const s = market.suppliers.find(s => s.id === id)
      if (s.fee == null || goods < s.minimum) { valid = false; break }
      cash += goods + (s.freeAt !== null && goods >= s.freeAt ? 0 : s.fee)
    }
    if (valid) {
      const key = JSON.stringify([[...spent.keys()].sort(), mixed])
      best.set(key, Math.min(best.get(key) ?? Infinity, cash))
    }
  }
  return best
}

test('split search agrees with independent whole-case receipts in 48 variant markets', () => {
  let seed = 4536
  const rand = n => (seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) % n
  for (let i = 0; i < 48; i++) {
    const market = { allowSplitSourcing: true, demand: {x:1+rand(5), y:1+rand(5)},
      suppliers: ['A','B'].map(id => rule(id,rand(6),rand(6),i%3 ? rand(6) : null)),
      offers: [['A','x'],['A','x'],['B','x'],['B','y'],['A','y']].map(([s,p],j) =>
        quote(s,p,'sku'+j,1+rand(4),1+rand(6),rand(9)!==0)) }
    const r = optimize(market)
    assert.equal(r.proven,true)
    const actual = new Map(r.baskets.map(b => [JSON.stringify([b.orders.map(o=>o.supplier).sort(),
      b.lines.length > Object.keys(market.demand).length]), b.total]))
    assert.equal(actual.size,r.baskets.length)
    assert.deepEqual(actual,enumerate(market),'market '+i)
  }
})

test('exact cup switch, same-set alternative and aggregate receipts', () => {
  for (const [cups,off,on] of [[1200,14100,14100],[1750,17100,15600],[1751,17100,17100]]) {
    const market = {...demo,demand:{cups,lids:1000}}
    assert.equal(optimize({...market,allowSplitSourcing:false}).baskets[0].total,off)
    const r = optimize(market)
    assert.equal(r.baskets[0].total,on)
    assert.equal(r.proven,true)
    if (cups === 1750) {
      assert.deepEqual(r.baskets.map(b=>b.total),[15600,17100,17400])
      assert.deepEqual(r.baskets[0].lines.map(l=>[l.id,l.cases]),[['A12',1],['B12',1],['B90',1]])
      assert.equal(r.baskets[0].fees,3500)
      assert.deepEqual(r.baskets[0].items.map(i=>[i.product,i.received,i.excess]),[['cups',1750,0],['lids',1000,0]])
    }
  }
})

test('combined minimum and excess at inclusive free delivery, with two SKUs at one supplier', () => {
  const m = {allowSplitSourcing:true,demand:{x:10,y:1},suppliers:[rule('S',500,900,1100),rule('unknown',null)],
    offers:[quote('S','x','six',6,500),quote('S','x','four',4,200),quote('S','y','one',1,200),
      quote('S','x','bad pack',null,1),quote('unknown','x','unknown terms',20,1)]}
  const r = optimize(m)
  const mixed = r.baskets.find(b=>b.lines.length===3)
  assert.equal(mixed.total,1100)
  assert.equal(mixed.fees,0)
  assert.ok(mixed.items.reduce((n,i)=>n+i.excess,0)>0)
  assert.ok(r.baskets.every(b=>b.lines.every(l=>!['bad pack','unknown terms'].includes(l.id))))
})

test('limited searches distinguish empty and feasible results, including very many quotes', () => {
  for (const [maxNodes,hasPlan] of [[1,false],[6,true]]) {
    const r = optimize(demo,{maxNodes})
    assert.equal(r.proven,false)
    assert.equal(r.nodes,maxNodes)
    assert.equal(Boolean(r.baskets.length),hasPlan)
    assert.equal(proofLabel(r),hasPlan?'Search limit reached · best found only':'No complete plan found within limit')
  }
  const offers = Array.from({length:15000},(_,i)=>quote('A','x',String(i),1,1))
  const r = optimize({...demo,offers,demand:{x:1000000}},{maxNodes:20000})
  assert.equal(r.nodes,20000)
  assert.equal(r.proven,false)
  assert.equal(r.baskets[0].total,1000000)
})

test('exact completion budget proves the result and a missing item excludes all receipts', () => {
  const full=optimize(demo)
  assert.equal(proofLabel(optimize(demo,{maxNodes:full.nodes})),'Verified optimum')
  assert.equal(optimize(demo,{maxNodes:full.nodes-1}).proven,false)
  const missing=optimize({...demo,demand:{...demo.demand,straws:1}})
  assert.deepEqual(missing.missing,['straws'])
  assert.deepEqual(missing.baskets,[])
  assert.equal(missing.nodes,0)
})

test('split sensitivity checks mixed pack sums and resumes at the first unchecked quantity', () => {
  const page = scanRange(demo,'cups',1748,1753,{maxEvents:3})
  assert.deepEqual(page.groups.map(g=>[g.start,g.end,g.total]),[[1748,1750,15600]])
  assert.equal(page.next,1751)
  const full = scanRange(demo,'cups',1748,1753)
  assert.deepEqual(full.groups.map(g=>[g.start,g.end,g.total]),[[1748,1750,15600],[1751,1753,17100]])
  assert.match(full.groups[1].why,/1,750 units:.*0 extra on this item/)
})
