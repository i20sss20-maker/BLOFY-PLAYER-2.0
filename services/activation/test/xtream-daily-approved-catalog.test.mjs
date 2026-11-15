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
 assert.match(code,/dailyReceipt:true,day:due\.day/);
 assert.match(code,/recordDailyCatalogOutcome\(controlPool/);
 assert.match(code,/internal\/blofy-stream\/ops\/daily-catalog/);
 assert.doesNotMatch(code,/dailyCatalogTick\(\).*copyMovie/);
});
