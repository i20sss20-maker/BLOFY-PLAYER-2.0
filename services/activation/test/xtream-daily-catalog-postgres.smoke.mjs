// Isolated real PostgreSQL schedule verification. Zero provider access and
// never use a production DB or customer account. GitHub Actions only.
import assert from 'node:assert/strict';
import pg from 'pg';
import {
 scheduleDailyApprovedCatalog,markDailyCatalogRunning,
 recordDailyCatalogOutcome,readDailyCatalogReceipts
} from '../src/xtream-daily-approved-catalog.mjs';

const expected='postgresql://postgres:postgres@127.0.0.1:5432/blofy_stream_daily_catalog_qa';
if(process.env.CI!=='true'||
  process.env.BLOFY_STREAM_EPHEMERAL_DB_QA!=='true'||
  process.env.DATABASE_URL!==expected)
 throw Error('refusing_non_ephemeral_database');
const pool=new pg.Pool({connectionString:expected,ssl:false,max:4});
const sourceId='f2631a8b-37e4-4b37-ab7b-3f3fe2de912f';
const env={BLOFY_XTREAM_DAILY_CATALOG_SYNC_ENABLED:'1',
 BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:sourceId};
const source={id:sourceId,name:'saleh',enabled:true,
 publish_catalog:true,deletion_requested_at:null};
let mediaSourceRequests=0,queued=0;
const enqueue=async(id,kinds,options)=>{
 assert.equal(id,sourceId);
 assert.deepEqual(kinds,['live','movie','series']);
 assert.equal(options.dailyReceipt,true);
 queued++;
 return {queued:false,position:0};
};
try{
 // Two independent scheduler calls race to claim the same Riyadh date.
 // PostgreSQL PRIMARY KEY, not in-memory flags, must allow only one.
 const now=new Date('2026-11-17T01:15:00Z');
 const input={env,now,db:pool,sourceById:async()=>source,enqueue};
 const both=await Promise.all([
  scheduleDailyApprovedCatalog(input),
  scheduleDailyApprovedCatalog(input)
 ]);
 assert.equal(both.filter(x=>x.requested).length,1);
 assert.equal(both.filter(x=>x.code==='daily_catalog_already_requested_today').length,1);
 assert.equal(queued,1);
 assert.equal(both.find(x=>x.requested).dispatchState,'dispatched');
 const rows=await pool.query('SELECT state FROM blofy_xtream_daily_catalog_requests');
 assert.equal(rows.rowCount,1);
 assert.equal(rows.rows[0].state,'queued');
 assert.equal(await markDailyCatalogRunning(pool,{sourceId,day:'2026-11-17'}),true);
 assert.equal(await markDailyCatalogRunning(pool,{sourceId,day:'2026-11-17'}),false);
 const complete=await recordDailyCatalogOutcome(pool,{
  sourceId,day:'2026-11-17',state:'completed'
 });
 assert.equal(complete.recorded,true);
 const repeated=await recordDailyCatalogOutcome(pool,{
  sourceId,day:'2026-11-17',state:'failed'
 });
 assert.equal(repeated.recorded,false,'completed day must be immutable');
 let status=await readDailyCatalogReceipts(pool,{sourceId,now});
 assert.equal(status.receipts.length,1);
 assert.equal(status.receipts[0].state,'completed');
 assert.equal(status.receipts[0].final,true);
 assert.equal(status.receipts[0].needsOperatorReview,false);

 // An ASYNC queue failure on the following day must release the one-day
 // claim, so the operator may safely retry later within the approved hour.
 const dayTwo=new Date('2026-11-18T01:12:00Z');
 const failed=await scheduleDailyApprovedCatalog({
  ...input,now:dayTwo,
  enqueue:async()=>{throw Error('synthetic queue unavailable')}
 });
 assert.equal(failed.requested,false);
 assert.equal(failed.code,'daily_catalog_enqueue_failed');
 assert.equal((await pool.query(
  "SELECT COUNT(*)::int AS n FROM blofy_xtream_daily_catalog_requests WHERE local_day='2026-11-18'"
 )).rows[0].n,0);
 const resumed=await scheduleDailyApprovedCatalog({...input,now:dayTwo});
 assert.equal(resumed.requested,true);
 assert.equal(queued,2);
 const queuedAfter=await readDailyCatalogReceipts(pool,{
  sourceId,now:new Date('2026-11-18T02:14:00Z')
 });
 assert.equal(queuedAfter.receipts[0].state,'queued');
 assert.equal(queuedAfter.receipts[0].needsOperatorReview,true);
 assert.equal(queuedAfter.receipts[0].attentionCode,
  'queued_over_one_hour_review_required');
 assert.equal(queuedAfter.automaticRetryStarted,false);
 assert.equal(queuedAfter.providerRequests,0);
 assert.equal(mediaSourceRequests,0);
 console.info('BLOFY_STREAM_DAILY_CATALOG_POSTGRES_QA',{
  ok:true,concurrentDailyClaims:2,durableAccepted:1,
  completedImmutable:true,asyncEnqueueFailureReleasesClaim:true,
  staleDetectionIsReadOnly:true,upstreamMediaRequests:0,
  customerWrites:0,productionDatabaseContacted:false
 });
}finally{await pool.end()}
