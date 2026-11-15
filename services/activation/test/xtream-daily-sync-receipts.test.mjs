import test from 'node:test';
import assert from 'node:assert/strict';
import {
 classifyDailyXtreamOutcome,recordDailyXtreamCatalogOutcome,
 readDailyXtreamCatalogReceipts
} from '../src/xtream-daily-sync-receipts.mjs';

const sourceId='123e4567-e89b-42d3-a456-426614174000';

test('daily result keeps partial imports distinct from fully completed',()=>{
 assert.equal(classifyDailyXtreamOutcome({ok:true}), 'completed');
 assert.equal(classifyDailyXtreamOutcome({ok:true,partialWarning:'categories_preserved'}),'partial');
 assert.equal(classifyDailyXtreamOutcome({ok:false}), 'failed');
});

test('record only queued daily requests, not manual Xtream sync',async()=>{
 const calls=[];
 const db={query:async(sql,args)=>{
  calls.push({sql,args});return {rowCount:1,rows:[{local_day:'2026-11-14'}]};
 }};
 const done=await recordDailyXtreamCatalogOutcome(db,{sourceId,state:'completed'});
 assert.equal(done.recorded,true);
 assert.equal(done.mediaFilesCopied,0);
 assert.match(calls[0].sql,/state='queued'/);
 assert.deepEqual(calls[0].args,[sourceId,'completed']);
 const none=await recordDailyXtreamCatalogOutcome({
  query:async()=>({rowCount:0,rows:[]})
 },{sourceId,state:'failed'});
 assert.equal(none.recorded,false);
});

test('read-only last seven local-day receipts with no raw provider URL',async()=>{
 const db={query:async(sql,args)=>({rows:[{
  local_day:'2026-11-14',requested_at:'2026-11-14T01:00:00Z',
  finished_at:'2026-11-14T01:05:00Z',state:'completed'
 }]})};
 const r=await readDailyXtreamCatalogReceipts(db,{sourceId});
 assert.equal(r.ok,true);
 assert.equal(r.receipts.length,1);
 assert.equal(r.receipts[0].state,'completed');
 assert.equal(r.mediaFilesCopied,0);
 assert.equal(JSON.stringify(r).includes('password'),false);
});

test('invalid state or UUID and absent tables fail closed',async()=>{
 await assert.rejects(()=>recordDailyXtreamCatalogOutcome({query:async()=>{}},{
  sourceId,state:'ready'
 }),/daily_xtream_outcome_invalid/);
 const r=await readDailyXtreamCatalogReceipts({query:async()=>{
  throw Object.assign(Error('missing'),{code:'42P01'})
 }},{sourceId});
 assert.deepEqual(r.receipts,[]);
});
