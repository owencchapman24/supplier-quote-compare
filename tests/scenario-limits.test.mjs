import test from 'node:test'
import assert from 'node:assert/strict'
import { scanRange } from '../app/scenarios.mjs'
import { optimize } from '../app/optimizer.mjs'

const suppliers=['A','B'].map(id=>({id,fee:0,minimum:0,freeAt:null}))
const offers=suppliers.map(({id})=>({id,supplier:id,pack:1,price:100,approved:true,product:'cups',row:2}))
const market={suppliers,offers,demand:{cups:3}}

test('large scans page by case event and keep tied recommendations',()=>{
  const r=scanRange(market,'cups',1,1000000,{maxEvents:2})
  assert.equal(r.next,3)
  assert.equal(r.groups.length,2)
  assert.equal(r.groups[1].orders,'A A × 2 OR B B × 2')
  assert.equal(r.groups[1].total,200)
  assert.equal(market.demand.cups,3)
  const limited=scanRange(market,'cups',r.next,1000000,{maxNodes:4})
  assert.equal(limited.nodes,4)
  assert.equal(limited.next,4)
  assert.equal(limited.groups[0].proven,false)
})

test('a stable top-up merges across raw case boundaries until the recommended count changes',()=>{
  const m={...market,suppliers:[{...suppliers[0],minimum:300}]}
  const {groups}=scanRange(m,'cups',1,4)
  assert.deepEqual(groups.map(g=>[g.start,g.end,g.total]),[[1,3,300],[4,4,400]])
  assert.match(groups[1].why,/3 units:.*0 extra on this item/)
})

test('equal receipts within one supplier set retain a representative and count',()=>{
  const m={...market,offers:[offers[0],{...offers[0],id:'Alternative SKU',row:3}]}
  const {baskets}=optimize(m)
  assert.equal(baskets.length,1)
  assert.equal(baskets[0].equalReceipts,2)
  assert.equal(baskets[0].lines[0].id,'A')
})
