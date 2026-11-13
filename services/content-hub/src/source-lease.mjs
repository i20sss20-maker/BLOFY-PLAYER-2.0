import pg from 'pg';

// Session-bound PostgreSQL advisory lock, not a TTL: if the worker dies,
// Postgres releases its lock. One Content Hub writer per exact source.
// This cannot block other software (e.g. a provider's independent live
// origin), so the worker also requires a separate upstream-quota check.
export function createSourceLease({connectionString,
  Pool=pg.Pool,applicationName='blofy-content-hub'}={}){
 if(!connectionString)throw Error('content_hub_db_required');
 const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:applicationName});
 return {
  async health(){
   const result=await pool.query('SELECT 1 AS ok');
   return Number(result.rows?.[0]?.ok)===1;
  },
  async acquire(sourceName){
   if(sourceName!=='saleh')throw Error('content_hub_source_invalid');
   const client=await pool.connect();
   let held=false;
   try{
    const lock=await client.query(`SELECT pg_try_advisory_lock(
       hashtext('blofy_content_hub_writer'),hashtext($1)) AS acquired`,
       [sourceName]);
    held=lock.rows?.[0]?.acquired===true;
    if(!held){client.release();return null}
    let released=false;
    return {release:async()=>{
      if(released)return;
      released=true;
      try{
        await client.query(`SELECT pg_advisory_unlock(
          hashtext('blofy_content_hub_writer'),hashtext($1))`,[sourceName]);
      }finally{client.release()}
    }};
   }catch(error){
    client.release(error);throw Error('content_hub_lock_unavailable');
   }
  },
  // A unique, durable operator run ID prevents accidental re-downloads
  // on restart. Only invoked after every operator safety gate passes.
  async claimPilotRun(runId){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||'')))
    throw Error('content_hub_invalid_pilot_run');
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_content_hub_pilot_runs (
     run_id TEXT PRIMARY KEY,
     state TEXT NOT NULL CHECK(state IN ('started','verified','failed')),
     result_code TEXT,
     started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     finished_at TIMESTAMPTZ
   )`);
   const result=await pool.query(`INSERT INTO blofy_content_hub_pilot_runs
     (run_id,state) VALUES ($1,'started') ON CONFLICT DO NOTHING
     RETURNING run_id`,[runId]);
   return result.rowCount===1;
  },
  async finishPilotRun(runId,{status,code}={}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||''))||
     !['verified','failed'].includes(status)||
     !/^[a-z0-9_]{1,80}$/.test(String(code||'')))
    throw Error('content_hub_invalid_pilot_result');
   await pool.query(`UPDATE blofy_content_hub_pilot_runs
     SET state=$2,result_code=$3,finished_at=NOW()
     WHERE run_id=$1 AND state='started'`,[runId,status,code]);
  },
  async close(){await pool.end()}
 };
}
