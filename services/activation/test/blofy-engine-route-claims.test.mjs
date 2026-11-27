import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineRouteClaims} from '../src/blofy-engine-route-claims.mjs';
const sourceId='00000000-0000-4000-8000-000000000001',requestId='00000000-0000-4000-8000-000000000002';
test('disabled or out of scope claims never touch database',async()=>{
 const db={query:async()=>{throw Error('unexpected query')}};
 assert.deepEqual(await createEngineRouteClaims(db,{sourceId}).claim({sourceId,requestId}),{acquired:false});
 assert.deepEqual(await createEngineRouteClaims(db,{sourceId,enabled:true}).claim({sourceId:'other',requestId}),{acquired:false});
});
test('claim and finish respect database row counts and scoped parameters',async()=>{
 let count=0,token;const db={query:async(sql,args)=>{
  if(sql.startsWith('INSERT')){assert.equal(args[0],requestId);assert.equal(args[1],sourceId);if(count++)return {rowCount:0};token=args[2];return {rowCount:1}}
  assert.equal(args[0],token);assert.equal(args[1],sourceId);assert.equal(args[2],'attached');return {rowCount:count++===2?1:0};
 }};
 const c=createEngineRouteClaims(db,{enabled:true,sourceId});
 const r=await c.claim({sourceId,requestId});assert.equal(r.acquired,true);assert.equal(r.token,token);
 assert.equal((await c.claim({sourceId,requestId})).acquired,false);
 assert.equal(await c.finish({token,result:{action:'arbitrary'}}),false);
 assert.equal(await c.finish({token,result:{action:'attached'}}),true);
 assert.equal(await c.finish({token,result:{action:'attached'}}),false);
});
