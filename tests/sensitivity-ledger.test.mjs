import test from 'node:test'
import assert from 'node:assert/strict'
import { scanRange } from '../app/scenarios.mjs'

const suppliers = [
  { id: 'A', fee: 0, minimum: 0, freeAt: null },
  { id: 'B', fee: 3500, minimum: 0, freeAt: null }
]
const offers = [
  { supplier: 'A', product: 'cups', id: 'A-C', row: 2, pack: 1000, price: 4800, approved: true },
  { supplier: 'B', product: 'cups', id: 'B-C', row: 3, pack: 750, price: 3300, approved: true },
  { supplier: 'B', product: 'lids', id: 'B-L', row: 4, pack: 1000, price: 4000, approved: true }
]

for (const lids of [false, true]) {
  test(`every quantity 1–5000 agrees with the independent cups ledger (lids=${lids})`, () => {
    const demand = lids ? { cups: 1200, lids: 1000 } : { cups: 1200 }
    const { groups, next } = scanRange({ demand, suppliers, offers }, 'cups', 1, 5000)
    assert.equal(next, null)
    let expectedStart = 1
    for (const group of groups) {
      assert.equal(group.start, expectedStart)
      assert.ok(group.end >= group.start)
      assert.equal(group.proven, true)
      for (let quantity = group.start; quantity <= group.end; quantity++) {
        const aCases = Math.ceil(quantity / 1000)
        const bCases = Math.ceil(quantity / 750)
        const aCash = 4800 * aCases + (lids ? 4000 + 3500 : 0)
        const bCash = 3300 * bCases + 3500 + (lids ? 4000 : 0)
        assert.equal(group.total, Math.min(aCash, bCash), `quantity ${quantity}`)
        if (aCash <= bCash) assert.ok(group.orders.includes(`A A-C × ${aCases}`))
        if (bCash <= aCash) assert.ok(group.orders.includes(`B B-C × ${bCases}`))
      }
      expectedStart = group.end + 1
    }
    assert.equal(expectedStart, 5001)
  })
}
