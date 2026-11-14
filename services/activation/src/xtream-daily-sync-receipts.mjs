// Private daily catalog job receipts. No source secrets, media or customer
// access. A queued Xtream import is NOT a successfully completed refresh.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STATES=new Set(['completed','partial','failed']);

export function classifyDailyXtreamOutcome({ok,partialWarning}={}) {
 if(ok!==true)return 'failed';
 return partialWarning?'partial':'completed';
}

export async function recordDailyXtreamCatalogOutcome(db,{
 sourceId,state
}={}) {
 if(!UUID.test(String(sourceId||''))||!STATES.has(state))
  throw Error('daily_xtream_outcome_invalid');
 if(typeof db?.query!=='function')throw Error('daily_xtream_database_missing');
 // Match only an as-yet-queued DAILY run. Never mutate unrelated source
 // catalog or invent a result when someone manually refreshed another feed.
 const result=await db.query(`UPDATE blofy_xtream_daily_catalog_requests
   SET state=$2,finished_at=NOW()
   WHERE source_id=$1 AND state='queued'
     AND requested_at>NOW()-INTERVAL '36 hours'
   RETURNING local_day`,[sourceId,state]).catch(error=>{
    if(error?.code==='42P01'||error?.code==='42703')return {rows:[],rowCount:0};
    throw error;
   });
 return {recorded:result.rowCount===1,state,
  customerCutover:false,mediaFilesCopied:0};
}

export async function readDailyXtreamCatalogReceipts(db,{
 sourceId,limit=7
}={}) {
 if(!UUID.test(String(sourceId||''))||
    !Number.isInteger(limit)||limit<1||limit>14)
  throw Error('daily_xtream_receipts_invalid');
 if(typeof db?.query!=='function')throw Error('daily_xtream_database_missing');
 const result=await db.query(`SELECT local_day,requested_at,
   finished_at,state FROM blofy_xtream_daily_catalog_requests
   WHERE source_id=$1 ORDER BY local_day DESC LIMIT $2`,
   [sourceId,limit]).catch(error=>{
   if(error?.code==='42P01'||error?.code==='42703')return {rows:[]};
   throw error;
  });
 return {ok:true,sourceId,receipts:(result.rows||[]).map(row=>({
   day:row.local_day,state:String(row.state||'queued'),
   requestedAt:row.requested_at||null,finishedAt:row.finished_at||null
  })),readOnly:true,mediaFilesCopied:0,customerCutover:false};
}
