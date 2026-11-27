import assert from 'node:assert/strict'
import test from 'node:test'
import { scanRange } from '../app/scenarios.mjs'

// The one lid case is mandatory and the B fee is already incurred. For every
// quantity <= 4,000, six B cases make a complete order costing at most $273.
// Seven cases of either cup SKU already cost more with the lids and freight.
const market = {
  demand: { cups: 1750, lids: 1000 },
  suppliers: [
    { id: 'A', fee: 0, minimum: 0, freeAt: null },
    { id: 'B', fee: 3500, minimum: 0, freeAt: null }
  ],
  offers: [
    { supplier: 'A', id: 'A-12', product: 'cups', pack: 1000, price: 4800, approved: true, row: 2 },
    { supplier: 'B', id: 'B-C12', product: 'cups', pack: 750, price: 3300, approved: true, row: 3 },
    { supplier: 'B', id: 'B-L90', product: 'lids', pack: 1000, price: 4000, approved: true, row: 4 }
  ]
}

test('split sensitivity pages agree with physical receipts at every cup quantity from 1 to 4,000', () => {
  const receipts = []
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 6; b++) {
      receipts.push({ received: 1000*a + 750*b, cost: 4800*a + 3300*b + 4000 + 3500 })
    }
  }
  receipts.sort((a,b) => a.cost - b.cost)
  let nextQuantity = 1
  while (nextQuantity <= 4000) {
    const page = scanRange({ ...market, allowSplitSourcing: true }, 'cups', nextQuantity, 4000)
    assert.ok(page.groups.length)
    for (const group of page.groups) {
      assert.equal(group.start, nextQuantity)
      assert.equal(group.proven, true)
      for (let quantity = group.start; quantity <= group.end; quantity++) {
        const expected = receipts.find(r => r.received >= quantity)
        assert.equal(group.total, expected.cost, 'cup quantity '+quantity)
      }
      nextQuantity = group.end + 1
    }
    assert.equal(page.next, nextQuantity > 4000 ? null : nextQuantity)
  }
  assert.equal(nextQuantity, 4001)
})
