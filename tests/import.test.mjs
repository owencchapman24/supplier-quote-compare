import test from 'node:test'
import assert from 'node:assert/strict'
import {cents,units,csvRows,cleanDemand,approvalKey} from '../app/import-data.mjs'
test('quoted CSV records preserve source text, escaped quotes, empty cells and newlines',()=>{
  assert.deepEqual(csvRows('\uFEFFsku,name,pack\r\n1,"Lid, ""tall""\nwhite",\r\n'),[['sku','name','pack'],['1','Lid, "tall"\nwhite','']])
  assert.throws(()=>csvRows('"a'))
})
test('cash and case counts require exact values',()=>{
  assert.deepEqual(['33.05','$1,200','1.999','','1e3','1,2','-1'].map(cents),[3305,120000,null,null,null,null,null])
  assert.deepEqual(['1,000','1.5','','0','750'].map(units),[1000,null,null,null,750])
})
test('demand template rejects duplicate products and missing quantities',()=>{
  assert.deepEqual(cleanDemand('product,units\nCups,1200'),[{product:'Cups',units:1200}])
  assert.throws(()=>cleanDemand('product,units\nCups,1\nCups,1'))
  assert.throws(()=>cleanDemand('product,units\nCups,'))
})
test('approval follows exact supplier, source, sheet, headers, roles and full row',()=>{
  const o={supplier:'B',file:'b.xlsx',sheet:'Rates',headers:['id','name','price','pack','fit'],map:{sku:0,name:1,pack:3,price:2},raw:['x','Lid','40','1000','90 mm']}
  const key=approvalKey(o)
  assert.equal(approvalKey({...o}),key)
  for(const delta of [{supplier:'A'},{file:'c.xlsx'},{sheet:'Other'},{headers:['X']},{map:{...o.map,price:3}},{raw:[...o.raw,'revised']}]) assert.notEqual(approvalKey({...o,...delta}),key)
})
