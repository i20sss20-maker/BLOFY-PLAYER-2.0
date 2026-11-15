// Owner-approved, source-bound Xtream CATALOG refresh, never media copying.
// Only the exact configured, currently published 'saleh' provider can run.
// One durable PostgreSQL claim each Riyadh day, and explicit completion
// receipts distinguish a queued import from successfully indexed metadata.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TERMINAL=new Set(['completed','partial','failed','cancelled']);
const TABLE='blofy_xtream_daily_catalog_requests';
export function configuredDailySourceId(env={}){
 const id=String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID||
   env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
 return UUID.test(id)?id.toLowerCase():null;
}
export function riyadhCatalogDay(now=new Date()){
 const d=new Date(now);
 if(!Number.isFinite(d.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',hourCycle:'h23'
 }).formatToParts(d).map(x=>[x.type,x.value]));
 return {day:[parts.year,parts.month,parts.day].join('-'),
  hour:Number(parts.hour)};
}
export function dueDailyCatalog(now=new Date(),env={}){
 if(env.BLOFY_XTREAM_DAILY_CATALOG_SYNC_ENABLED!=='1')
  return {due:false,code:'daily_catalog_disabled'};
 const date=riyadhCatalogDay(now);
 if(!date)return {due:false,code:'daily_catalog_invalid_clock'};
 if(date.hour!==4)return {due:false,code:'daily_catalog_outside_0400_0500',
  day:date.day};
 const sourceId=configuredDailySourceId(env);
 if(!sourceId)return {due:false,code:'daily_catalog_source_not_configured',
  day:date.day};
 return {due:true,code:'daily_catalog_due',day:date.day,sourceId};
}
async function ensureTable(db){
 await db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
  source_id UUID NOT NULL,
  local_day DATE NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK(state IN ('queued','running','completed','partial','failed','cancelled')),
  PRIMARY KEY(source_id,local_day)
 )`);
}
export async function scheduleDailyApprovedCatalog({
 env={},now=new Date(),db,sourceById,enqueue,sourceBusy=()=>false
}={}){
 const due=dueDailyCatalog(now,env);
 if(!due.due)return {ok:false,requested:false,code:due.code,
  customerCutover:false,mediaFilesCopied:0};
 if(typeof db?.query!=='function'||typeof sourceById!=='function'||
    typeof enqueue!=='function')
  return {ok:false,requested:false,code:'daily_catalog_dependencies_missing'};
 let source;
 try{source=await sourceById(due.sourceId)}catch{
  return {ok:false,requested:false,code:'daily_catalog_source_unavailable'}}
 if(!source||String(source.id||'').toLowerCase()!==due.sourceId||
    String(source.name||'').trim().toLowerCase()!=='saleh'||
    source.enabled!==true||source.publish_catalog!==true||
    source.deletion_requested_at)
  return {ok:false,requested:false,code:'daily_catalog_source_not_approved'};
 if(sourceBusy(due.sourceId))
  return {ok:false,requested:false,code:'daily_catalog_source_busy'};
 await ensureTable(db);
 const claim=await db.query(`INSERT INTO ${TABLE}
  (source_id,local_day,state) VALUES($1,$2::date,'queued')
  ON CONFLICT DO NOTHING RETURNING source_id`,
  [due.sourceId,due.day]);
 if(claim.rowCount!==1)return {ok:false,requested:false,
  code:'daily_catalog_already_requested_today',
  day:due.day,sourceId:due.sourceId};
 try{
  const result=enqueue(due.sourceId,['live','movie','series'],{
   dailyReceipt:true,day:due.day});
  return {ok:true,requested:true,queued:result?.queued===true,
   code:'daily_catalog_enqueued',day:due.day,sourceId:due.sourceId,
   mediaFilesCopied:0,customerCutover:false};
 }catch{
  // An enqueue failure must not consume today's allowed attempt.
  await db.query(`DELETE FROM ${TABLE}
   WHERE source_id=$1 AND local_day=$2::date AND state='queued'`,
   [due.sourceId,due.day]).catch(()=>{});
  return {ok:false,requested:false,code:'daily_catalog_enqueue_failed',
   day:due.day,sourceId:due.sourceId};
 }
}
export async function markDailyCatalogRunning(db,{sourceId,day}={}){
 if(!UUID.test(String(sourceId||''))||
    !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(String(day||'')))
  throw Error('daily_catalog_receipt_invalid');
 const r=await db.query(`UPDATE ${TABLE}
   SET state='running',started_at=NOW()
   WHERE source_id=$1 AND local_day=$2::date AND state='queued'`,
  [sourceId,day]);
 return r.rowCount===1;
}
export async function recordDailyCatalogOutcome(db,{sourceId,day,state}={}){
 if(!UUID.test(String(sourceId||''))||
    !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(String(day||''))||
    !TERMINAL.has(state))throw Error('daily_catalog_receipt_invalid');
 const r=await db.query(`UPDATE ${TABLE}
   SET state=$3,finished_at=NOW()
   WHERE source_id=$1 AND local_day=$2::date
    AND state IN ('queued','running')`,
  [sourceId,day,state]);
 return {recorded:r.rowCount===1,state,
  mediaFilesCopied:0,customerCutover:false};
}
export async function readDailyCatalogReceipts(db,{sourceId,limit=7}={}){
 if(!UUID.test(String(sourceId||''))||
    !Number.isSafeInteger(limit)||limit<1||limit>14)
  throw Error('daily_catalog_receipts_invalid');
 const r=await db.query(`SELECT local_day,requested_at,started_at,
  finished_at,state FROM ${TABLE}
  WHERE source_id=$1 ORDER BY local_day DESC LIMIT $2`,
  [sourceId,limit]).catch(e=>{
   if(e?.code==='42P01')return {rows:[]};
   throw e;
  });
 return {ok:true,readOnly:true,
  sourceId,receipts:(r.rows||[]).map(x=>({
   day:typeof x.local_day==='string'?x.local_day:
    new Date(x.local_day).toISOString().slice(0,10),
   state:String(x.state||'queued'),
   requestedAt:x.requested_at||null,startedAt:x.started_at||null,
   finishedAt:x.finished_at||null,
   final:Boolean(x.finished_at&&TERMINAL.has(x.state))
  })),mediaFilesCopied:0,customerCutover:false};
}
