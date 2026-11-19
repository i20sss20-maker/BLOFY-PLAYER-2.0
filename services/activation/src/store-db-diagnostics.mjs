// Read-only, owner-only PostgreSQL health snapshot for BLOFY ONE.
// pg_stat_database.deadlocks and temp_bytes are cumulative since stats_reset.
// Never return SQL text, DB credentials, table contents, IP addresses or customer data.
export const DB_DIAGNOSTICS_QUERY = `
 SELECT
  d.numbackends::int AS connections,
  d.deadlocks::bigint AS deadlocks_total,
  d.temp_bytes::bigint AS temp_bytes_total,
  d.stats_reset,
  (SELECT COUNT(*)::int FROM pg_stat_activity a
    WHERE a.datname=current_database() AND a.state='active') AS active_queries,
  (SELECT COUNT(*)::int FROM pg_stat_activity a
    WHERE a.datname=current_database() AND a.wait_event_type='Lock') AS lock_waiters,
  (SELECT COALESCE(ROUND(MAX(EXTRACT(EPOCH FROM
      (NOW()-a.xact_start)))::numeric,1),0)
   FROM pg_stat_activity a WHERE a.datname=current_database()
      AND a.xact_start IS NOT NULL AND a.state<>'idle') AS longest_transaction_seconds
 FROM pg_stat_database d WHERE d.datname=current_database()
`;
const n=v=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
export function summarizeDbDiagnostics(row){
 if(!row)return {ok:false,available:false};
 const active=n(row.active_queries),waiting=n(row.lock_waiters),seconds=n(row.longest_transaction_seconds);
 return {ok:true,available:true,
  connections:n(row.connections),activeQueries:active,lockWaiters:waiting,
  longestTransactionSeconds:seconds,
  deadlocksTotal:n(row.deadlocks_total),temporaryBytesTotal:n(row.temp_bytes_total),
  statisticsResetAt:row.stats_reset||null,
  attention:waiting>0||seconds>120,
  explanation:'Deadlocks and temporary bytes are cumulative since the PostgreSQL statistics reset; a nonzero total is not an active incident.'
 };
}
export function createStoreDbDiagnostics({pool,json,authorizeAdmin=()=>false}={}){
 if(!pool?.query||!json)throw Error('store_db_diagnostics_dependencies_invalid');
 return async function handler(req,res,url){
  if(url.pathname!=='/api/v1/admin/store/database-health'||req.method!=='GET')
   return false;
  if(!authorizeAdmin(req,res))return true;
  try{
   const result=await pool.query(DB_DIAGNOSTICS_QUERY);
   const summary=summarizeDbDiagnostics(result.rows?.[0]);
   return json(res,200,summary,{
    'cache-control':'private, no-store','x-content-type-options':'nosniff'
   }),true;
  }catch(error){
   // Owners should know diagnostics are unavailable, not confuse it with a healthy DB.
   return json(res,503,{ok:false,available:false,error:'database_health_unavailable'},
    {'cache-control':'private, no-store'}),true;
  }
 };
}
