// Durable, fail-closed selection of only the first TWO independently
// authenticated STREAM subscriber accounts per licensed source. This registry
// is shared across all portal instances and survives Railway redeployments.
// It is intentionally disabled unless all operator pilot flags are enabled.
// No Xtream credentials, media URLs or voucher plaintext are ever stored.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tableByPool=new WeakMap();
async function ensurePilotTable(pool){
 let ready=tableByPool.get(pool);
 if(!ready){
  ready=pool.query(`CREATE TABLE IF NOT EXISTS
    blofy_stream_shared_trial_accounts (
      source_id uuid NOT NULL,
      account_id uuid NOT NULL,
      claimed_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source_id,account_id)
    )`).catch(error=>{tableByPool.delete(pool);throw error});
  tableByPool.set(pool,ready);
 }
 return ready;
}
export function durableSharedLiveTrialEnabled(env=process.env){
 return env.BLOFY_STREAM_SHARED_LIVE_DURABLE_PILOT==='1'&&
   env.BLOFY_STREAM_SHARED_LIVE_FIRST_ACCOUNT_TEST_ENABLED==='1'&&
   env.BLOFY_STREAM_SHARED_LIVE_CANARY==='1'&&
   String(env.BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME||'').trim().toLowerCase()==='saleh';
}
export async function claimDurableSharedLiveTrial(pool,{
  sourceId,accountId,sourceName
}={},env=process.env){
 if(!durableSharedLiveTrialEnabled(env)||
   !UUID.test(String(sourceId||''))||!UUID.test(String(accountId||''))||
   String(sourceName||'').trim().toLowerCase()!=='saleh')return false;
 const maxAccounts=env.BLOFY_STREAM_SHARED_LIVE_TWO_ACCOUNT_TEST_ENABLED==='1'?2:1;
 let client=null,inTransaction=false;
 try{
  await ensurePilotTable(pool);
  client=await pool.connect();
  await client.query('BEGIN');inTransaction=true;
  // Fixed advisory lock protects the small trial registry even if two
  // separate portal replicas receive the first customer requests together.
  await client.query('SELECT pg_advisory_xact_lock(11122983, 20261110)');
  const records=await client.query(`SELECT account_id
    FROM blofy_stream_shared_trial_accounts
    WHERE source_id=$1 ORDER BY claimed_at,account_id LIMIT 3`,[sourceId]);
  const admitted=records.rows.slice(0,maxAccounts).some(r=>
    String(r.account_id).toLowerCase()===String(accountId).toLowerCase());
  if(!admitted&&records.rows.length<maxAccounts){
   await client.query(`INSERT INTO blofy_stream_shared_trial_accounts
      (source_id,account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
     [sourceId,accountId]);
  }
  await client.query('COMMIT');inTransaction=false;
  return admitted||records.rows.length<maxAccounts;
 }catch{
  if(inTransaction)try{await client.query('ROLLBACK')}catch{}
  // Do not silently broaden pilot to an in-memory allowlist if database
  // connectivity fails. This customer keeps the legacy playback path.
  return false;
 }finally{
  client?.release();
 }
}
// Sanitized administrative summary. Never returns actual account IDs.
export async function durableSharedLiveTrialStatus(pool,env=process.env){
 if(!durableSharedLiveTrialEnabled(env))
  return {enabled:false,limit:0,claimed:0,persistent:false};
 try{
  await ensurePilotTable(pool);
  const result=await pool.query(`SELECT COUNT(*)::int AS count
    FROM blofy_stream_shared_trial_accounts`);
  return {enabled:true,limit:env.BLOFY_STREAM_SHARED_LIVE_TWO_ACCOUNT_TEST_ENABLED==='1'?2:1,
    claimed:Math.min(10000,Math.max(0,Number(result.rows[0]?.count||0))),
    persistent:true};
 }catch{return {enabled:true,limit:2,claimed:null,persistent:false}}
}
