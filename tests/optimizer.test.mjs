import test from 'node:test'
import assert from 'node:assert/strict'
import { optimize } from '../app/optimizer.mjs'

const supplier = (id, fee = 0, minimum = 0, freeAt = null) => ({ id, fee, minimum, freeAt })
const quote = (supplier, product, pack, price, approved = true) =>
  ({ id: [supplier, product, pack, price].join('-'), supplier, product, pack, price, approved })
const A = supplier('A'), B = supplier('B', 3500)
const cups = [quote('A', 'cups', 1000, 4800), quote('B', 'cups', 750, 3300)]
const lids = quote('B', 'lids', 1000, 4000)
const solve = (demand, offers = cups, suppliers = [A, B], options) =>
  optimize({ demand, offers, suppliers }, options)
const prices = result => result.baskets.map(b => b.total)

test('1,200 cups at whole-case cash prices', () => {
  const r = solve({ cups: 1200 })
  assert.deepEqual(prices(r), [9600, 10100])
  assert.deepEqual(r.baskets.map(b => b.lines[0].excess), [800, 300])
  assert.equal(r.proven, true)
})
test('2,100 cups reverses the winner', () => {
  const r = solve({ cups: 2100 })
  assert.deepEqual(prices(r), [13400, 14400])
  assert.equal(r.baskets[0].lines[0].supplier, 'B')
})
test('compatible lids make the cheapest cups supplier lose the basket', () => {
  const r = solve({ cups: 1200, lids: 1000 }, [...cups, lids, quote('A','lids',1000,100,false)])
  assert.deepEqual(prices(r), [14100, 17100])
  assert.deepEqual(r.baskets.map(b => b.orders.length), [1, 2])
  assert.deepEqual(r.baskets.map(b => b.fees), [3500, 3500])
  assert.equal(r.baskets[1].total - r.baskets[0].total, 3000)
  assert.equal(r.baskets[0].merchandise, 10600)
})
test('missing packs, unknown freight and partial orders cannot qualify', () => {
  assert.deepEqual(prices(solve({ cups: 1200 }, [...cups, quote('B','cups',null,1)])), [9600,10100])
  assert.deepEqual(prices(solve({ cups: 1, lids: 1 })), [])
  assert.deepEqual(prices(solve({ cups: 1 }, cups, [A, supplier('B',null)])), [4800])
})
test('inclusive merchandise minimum, just below requires a legal top-up', () => {
  const offer = [quote('A','cups',10,999)]
  for (const [min,total,cases] of [[999,1122,1], [1000,2121,2]]) {
    const r = solve({ cups: 10 }, offer, [supplier('A',123,min)])
    assert.deepEqual(prices(r), [total])
    assert.equal(r.baskets[0].lines[0].cases,cases)
  }
})
test('top-up on the right line earns free freight at exact threshold', () => {
  const r = solve({ cups: 1,lids: 1 }, [quote('A','cups',1,800),quote('A','lids',1,200)], [supplier('A',500,0,1200)])
  assert.deepEqual(prices(r), [1200])
  assert.equal(r.baskets[0].fees,0)
  assert.equal(r.baskets[0].lines.find(l => l.product === 'lids').cases,2)
})
test('two suppliers beat both singles and ties keep both equal-cost suppliers', () => {
  const offers = [quote('A','x',1,100), quote('A','y',1,900), quote('B','x',1,900), quote('B','y',1,100)]
  assert.deepEqual(prices(solve({x:1,y:1},offers,[supplier('A',20),supplier('B',20)])),[240,1020,1020])
  assert.deepEqual(prices(solve({x:1}, [quote('A','x',1,100),quote('B','x',1,100)], [A,supplier('B')])), [100,100])
})
test('search budget cannot imply optimality or infeasibility', () => {
  const r = solve({cups:1200,lids:1000},[...cups,lids],[A,B],{maxNodes:2})
  assert.equal(r.proven,false)
  for (const b of r.baskets) assert.equal(b.lines.length,2)
  const firstReceipt = solve({cups:2100},cups,[A,B],{maxNodes:4})
  assert.deepEqual(prices(firstReceipt),[14400])
  assert.equal(firstReceipt.proven,false)
})

// Tiny independent ledger oracle. Buy 0..10 cases of each SKU, then reject
// illegal receipts. Generated quantities <=3 and thresholds <=6 (prices >=1)
// guarantee that 10 cases covers every potentially optimal purchase.
function oracle(demand, offers, rules) {
  const best = new Map()
  for (let n = 0; n < 11 ** offers.length; n++) {
    let digits = n
    const covered = new Set(), spent = new Map()
    let legal = true
    for (const o of offers) {
      const count = digits % 11
      digits = Math.floor(digits / 11)
      if (!count) continue
      if (!o.approved || covered.has(o.product) || count*o.pack < demand[o.product]) { legal = false; break }
      covered.add(o.product)
      spent.set(o.supplier,(spent.get(o.supplier) || 0) + count*o.price)
    }
    if (!legal || covered.size !== Object.keys(demand).length) continue
    let total = 0
    for (const [id,sub] of spent) {
      const rule = rules.find(s => s.id === id)
      if (sub < rule.minimum) { legal = false; break }
      total += sub + (rule.freeAt !== null && sub >= rule.freeAt ? 0 : rule.fee)
    }
    if (legal) {
      const key = [...spent.keys()].sort().join(',')
      best.set(key, Math.min(best.get(key) ?? Infinity, total))
    }
  }
  return [...best].sort()
}
test('80 reproducible small markets agree with independent exhaustive receipts by supplier set', () => {
  let seed = 12345
  const rand = n => ((seed = (Math.imul(1664525,seed) + 1013904223) >>> 0) / 2**32 * n) | 0
  for (let i = 0; i < 80; i++) {
    const demand = { x: 1+rand(3), y: 1+rand(3) }
    const rules = ['A','B'].map(id => supplier(id,rand(7),rand(7),rand(2) ? rand(7) : null))
    const offers = rules.flatMap(s => ['x','y'].map(p => quote(s.id,p,1+rand(3),1+rand(6),rand(5)>0)))
    const r = solve(demand,offers,rules)
    assert.equal(r.proven,true)
    assert.deepEqual(r.baskets.map(b => [b.orders.map(o => o.supplier).sort().join(','),b.total]).sort(), oracle(demand,offers,rules), 'market '+i)
  }
})
