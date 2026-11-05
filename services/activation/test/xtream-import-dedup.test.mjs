import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctXtreamRecords } from '../src/xtream-import-dedup.mjs';

test('Xtream category batch collapses duplicates without changing order of different groups',()=>{
  const rows=[
    {sourceCategoryId:'sports',name:'Sports 1'},
    {sourceCategoryId:'news',name:'News'},
    {sourceCategoryId:'sports',name:'Sports 2'}
  ];
  const result=distinctXtreamRecords(rows,'sourceCategoryId');
  assert.equal(result.length,2);
  assert.deepEqual(result.map(x=>x.sourceCategoryId),['sports','news']);
  assert.equal(result[0].name,'Sports 2');
  assert.equal(rows.length,3);
});

test('Xtream item batches never repeat the same source ID in one upsert',()=>{
  const rows=[{sourceId:9,name:'Movie 1'},{sourceId:'9',name:'Movie 2'},
    {sourceId:10,name:'Movie 3'}, {sourceId:'',name:'Broken'}, null];
  assert.deepEqual(distinctXtreamRecords(rows,'sourceId').map(x=>x.name),['Movie 2','Movie 3']);
  assert.throws(()=>distinctXtreamRecords(rows,'wrongField'),/invalid_xtream_unique_field/);
});
