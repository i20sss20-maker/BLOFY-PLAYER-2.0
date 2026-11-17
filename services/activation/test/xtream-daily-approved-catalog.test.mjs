import test from 'node:test';
import assert from 'node:assert/strict';
import {
 configuredDailySourceId,riyadhCatalogDay,dueDailyCatalog,
 scheduleDailyApprovedCatalog,markDailyCatalogRunning,
 recordDailyCatalogOutcome,readDailyCatalogReceipts
} from '../src/xtream-daily-approved-catalog.mjs';

const SOURCE_ID='87654321-4321-4321-8321-876543218765';
const NOW=new Date('2026-11-16T01:15:00.000Z'); // 04:15 Riyadh
const ENV={BLOFY_XTREAM_DAILY_CATALOG_SYNC_ENABLED:'1',
 BLOFY_XTREAM_EGRESS_SOURCE_ID:SOURCE_ID};
const SOURCE={id:SOURCE_ID,name:'saleh',enabled:true,
 publish_catalog:true,deletion_requested_at:null};
function dbFixture(){
 const sql=[];let claimed=false;
 return {
  sql,
  get claimed(){return claimed},
  async query(statement,params){
   sql.push({statement,params});
   if(statement.startsWith('CREATE TABLE'))return {rowCount:0,rows:[]};
   if(statement.startsWith('INSERT INTO')){
    if(claimed)return {rowCount:0,rows:[]};
    claimed=true;return {rowCount:1,rows:[{source_id:SOURCE_ID}]};
   }
   if(statement.startsWith('DELETE FROM')){
    claimed=false;return {rowCount:1,rows:[]};
   }
   if(statement.startsWith('UPDATE'))return {rowCount:1,rows:[]};
   if(statement.startsWith('SELECT'))return {rows:[{
    local_day:'2026-11-16',state:'completed',
    requested_at:NOW,started_at:NOW,finished_at:NOW}]};
   throw Error('unexpected_sql');
  }
 };
}
test('daily import only at 04 Riyadh with explicit opt-in, precise source ID',()=>{
 assert.deepEqual(riyadhCatalogDay(NOW),{day:'2026-11-16',hour:4});
 assert.equal(dueDailyCatalog(NOW,{}).code,'daily_catalog_disabled');
 assert.equal(dueDailyCatalog(new Date('2026-11-16T02:01:00Z'),ENV).due,false);
 assert.equal(dueDailyCatalog(NOW,ENV).due,true);
 assert.equal(configuredDailySourceId(ENV),SOURCE_ID);
 assert.equal(dueDailyCatalog(NOW,{...ENV,BLOFY_XTREAM_EGRESS_SOURCE_ID:'invalid'}).due,false);
 assert.equal(riyadhCatalogDay('bad-date'),null);
});
test('one approved published saleh source gets one durable daily metadata import',async()=>{
 const db=dbFixture(),enqueued=[];
 const work={env:ENV,now:NOW,db,
  sourceById:async id=>{assert.equal(id,SOURCE_ID);return SOURCE},
  enqueue:(id,types,opts)=>{
   enqueued.push({id,types,opts});return {queued:false}
  }};
 const first=await scheduleDailyApprovedCatalog(work);
 assert.equal(first.requested,true);
 assert.equal(first.code,'daily_catalog_enqueued');
 assert.equal(first.mediaFilesCopied,0);
 assert.equal(first.customerCutover,false);
 assert.deepEqual(enqueued[0].types,['live','movie','series']);
 assert.equal(enqueued[0].opts.day,'2026-11-16');
 assert.equal(enqueued[0].opts.dailyReceipt,true);
 const second=await scheduleDailyApprovedCatalog(work);
 assert.equal(second.requested,false);
 assert.equal(second.code,'daily_catalog_already_requested_today');
 assert.equal(enqueued.length,1);
 assert.equal(db.sql.filter(x=>x.statement.startsWith('INSERT INTO')).length,2);
});
test('never sync disabled/unpublished/unapproved source; no DB claim',async()=>{
 for(const source of [{...SOURCE,name:'another'}, {...SOURCE,enabled:false},
   {...SOURCE,publish_catalog:false},
   {...SOURCE,deletion_requested_at:'2026-11-15T00:00:00Z'},
   {...SOURCE,id:'00000000-0000-4000-8000-000000000001'}]){
  const db=dbFixture();
  const result=await scheduleDailyApprovedCatalog({
   env:ENV,now:NOW,db,sourceById:async()=>source,
   enqueue:()=>{throw Error('not_called')}
  });
  assert.equal(result.requested,false);
  assert.equal(result.code,'daily_catalog_source_not_approved');
  assert.equal(db.sql.length,0);
 }
});
test('busy source does not claim or contact provider',async()=>{
 const db=dbFixture();
 const out=await scheduleDailyApprovedCatalog({
  env:ENV,now:NOW,db,sourceById:async()=>SOURCE,
  enqueue:()=>{throw Error('never')},sourceBusy:()=>true
 });
 assert.equal(out.code,'daily_catalog_source_busy');
 assert.equal(db.sql.length,0);
});
test('failed queue submission releases claim for retry in same one-hour window',async()=>{
 const db=dbFixture();
 const out=await scheduleDailyApprovedCatalog({
  env:ENV,now:NOW,db,sourceById:async()=>SOURCE,
  enqueue:()=>{throw Error('no_capacity')}
 });
 assert.equal(out.code,'daily_catalog_enqueue_failed');
 assert.equal(db.claimed,false);
 assert.equal(db.sql.some(s=>s.statement.startsWith('DELETE FROM')),true);
});
test('separate queued, running, completed, partial and failed receipts',async()=>{
 const db=dbFixture();
 assert.equal(await markDailyCatalogRunning(db,{sourceId:SOURCE_ID,day:'2026-11-16'}),true);
 const x=await recordDailyCatalogOutcome(db,{
  sourceId:SOURCE_ID,day:'2026-11-16',state:'partial'});
 assert.equal(x.recorded,true);
 assert.equal(x.mediaFilesCopied,0);
 assert.equal(db.sql.some(s=>s.params?.includes('partial')),true);
 await assert.rejects(()=>recordDailyCatalogOutcome(db,{
  sourceId:SOURCE_ID,day:'2026-11-16',state:'unknown'}));
 const receipts=await readDailyCatalogReceipts(db,{sourceId:SOURCE_ID});
 assert.equal(receipts.ok,true);
 assert.equal(receipts.readOnly,true);
 assert.equal(receipts.receipts[0].state,'completed');
 assert.equal(receipts.receipts[0].final,true);
 assert.equal(receipts.customerCutover,false);
});
test('daily scheduler integrated only into authenticated STREAM gateway controls',async()=>{
 const {readFile}=await import('node:fs/promises');
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/dailyCatalogTimer=setInterval/);
 assert.match(code,/dailyCatalogStartupTimer=setTimeout/);
 assert.match(code,/options\?\.dailyReceipt===true/);
 assert.match(code,/recordDailyCatalogOutcome\(controlPool/);
 assert.match(code,/internal\/blofy-stream\/ops\/daily-catalog/);
 assert.doesNotMatch(code,/dailyCatalogTick\(\).*copyMovie/);
});

test('daily sync waits for async acceptance, distinguishes immediate dispatch from rejection',async()=>{
 const db=dbFixture(),events=[];
 const args={env:ENV,now:NOW,db,
  sourceById:async()=>SOURCE,
  enqueue:async()=>{await new Promise(resolve=>setTimeout(resolve,2));
   events.push('queue_committed');return {queued:false,position:0}
  }
 };
 const result=await scheduleDailyApprovedCatalog(args);
 assert.equal(result.accepted,true);
 assert.equal(result.queued,false);
 assert.equal(result.dispatchState,'dispatched');
 assert.equal(events.length,1);
 assert.equal(db.claimed,true);
});
test('rejected asynchronous enqueue and absent queue acknowledgement release durable claim',async()=>{
 for(const enqueue of [
  async()=>{throw Error('synthetic queue rejection')},
  async()=>undefined,
  ()=>({}),
  ()=>({queued:'yes'})
 ]){
  const db=dbFixture();
  const result=await scheduleDailyApprovedCatalog({
   env:ENV,now:NOW,db,sourceById:async()=>SOURCE,enqueue
  });
  assert.equal(result.ok,false);
  assert.equal(result.requested,false);
  assert.equal(result.code,'daily_catalog_enqueue_failed');
  assert.equal(db.claimed,false,'stale daily claim must not survive failed queue acceptance');
  assert.equal(db.sql.filter(x=>x.statement.startsWith('DELETE FROM')).length,1);
 }
});
test('stuck queued/running receipt is signalled after conservative thresholds but never retried automatically',async()=>{
 const requests=[];
 const base=new Date('2026-11-17T13:00:00.000Z');
 const db={query:async(sql,args)=>{
  requests.push({sql,args});
  return {rows:[
   {local_day:'2026-11-17',state:'queued',
    requested_at:new Date(base.getTime()-61*60000),
    started_at:null,finished_at:null},
   {local_day:'2026-11-16',state:'running',
    requested_at:new Date(base.getTime()-9*3600000),
    started_at:new Date(base.getTime()-361*60000),finished_at:null},
   {local_day:'2026-11-15',state:'completed',
    requested_at:new Date(base.getTime()-48*3600000),
    started_at:new Date(base.getTime()-47*3600000),
    finished_at:new Date(base.getTime()-46*3600000)}
  ]};
 }};
 const r=await readDailyCatalogReceipts(db,{sourceId:SOURCE_ID,now:base});
 assert.equal(r.readOnly,true);
 assert.equal(r.providerRequests,0);
 assert.equal(r.automaticRetryStarted,false);
 assert.equal(r.manualReviewSuggested,true);
 assert.equal(r.receipts[0].ageMinutes,61);
 assert.equal(r.receipts[0].attentionCode,'queued_over_one_hour_review_required');
 assert.equal(r.receipts[1].attentionCode,'running_over_six_hours_review_required');
 assert.equal(r.receipts[2].attentionCode,null);
 assert.equal(r.receipts[2].ageMinutes,null);
 assert.equal(r.receipts[2].final,true);
 assert.equal(requests.length,1);
 assert.match(requests[0].sql,/^SELECT /);
});
test('recent queue receipt is not mislabeled stuck; invalid clock refused before DB reads',async()=>{
 let queried=0;
 const base=new Date('2026-11-17T13:00:00.000Z');
 const db={query:async()=>{queried++;return {rows:[{
  local_day:'2026-11-17',state:'running',
  requested_at:new Date(base.getTime()-40*60000),
  started_at:new Date(base.getTime()-20*60000),
  finished_at:null
 }]}}};
 const r=await readDailyCatalogReceipts(db,{sourceId:SOURCE_ID,now:base});
 assert.equal(r.manualReviewSuggested,false);
 assert.equal(r.receipts[0].attentionCode,null);
 assert.equal(r.receipts[0].ageMinutes,20);
 await assert.rejects(()=>readDailyCatalogReceipts(db,{
  sourceId:SOURCE_ID,now:'bad-date'
 }),/daily_catalog_receipts_invalid/);
 assert.equal(queried,1);
});

test('concurrent PostgreSQL IF NOT EXISTS type-name race is recovered only when exact table exists',async()=>{
 let creates=0,checked=0,inserted=0;
 const db={query:async(sql,args)=>{
  if(sql.startsWith('CREATE TABLE')){
   creates++;throw Object.assign(Error('concurrent type name'),{
    code:'23505',constraint:'pg_type_typname_nsp_index'
   });
  }
  if(sql.startsWith('SELECT to_regclass')){
   checked++;
   assert.deepEqual(args,['public.blofy_xtream_daily_catalog_requests']);
   return {rows:[{table_oid:'blofy_xtream_daily_catalog_requests'}]};
  }
  if(sql.startsWith('INSERT INTO')){
   inserted++;return {rowCount:1,rows:[{source_id:SOURCE_ID}]};
  }
  throw Error('unexpected SQL');
 }};
 const out=await scheduleDailyApprovedCatalog({
  env:ENV,now:NOW,db,sourceById:async()=>SOURCE,
  enqueue:()=>({queued:false})
 });
 assert.equal(out.requested,true);
 assert.equal(creates,1);
 assert.equal(checked,1);
 assert.equal(inserted,1);
});
test('other PostgreSQL errors or unconfirmed DDL type conflict cannot grant a daily claim',async()=>{
 for(const exception of [
  Object.assign(Error('permission denied'),{code:'42501'}),
  Object.assign(Error('another table collision'),{code:'23505',
   constraint:'unrelated_unique_constraint'}),
  Object.assign(Error('type race but no table'),{code:'23505',
   constraint:'pg_type_typname_nsp_index'})
 ]){
  let calls=0;
  const db={query:async(sql)=>{
   calls++;
   if(sql.startsWith('CREATE TABLE'))throw exception;
   if(sql.startsWith('SELECT to_regclass'))return {rows:[{table_oid:null}]};
   throw Error('unexpected SQL');
  }};
  await assert.rejects(()=>scheduleDailyApprovedCatalog({
   env:ENV,now:NOW,db,sourceById:async()=>SOURCE,
   enqueue:()=>{throw Error('never enqueue')}
  }));
  assert.ok(calls<=2);
 }
});
