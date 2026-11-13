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
  // Persistent pilot control-plane; no subscriber access to this data.
  async claimPilotRun(runId,{expectedBytes}={}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||''))||
      !Number.isSafeInteger(expectedBytes)||expectedBytes<=0)
    throw Error('content_hub_invalid_pilot_run');
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_content_hub_pilot_runs (
     run_id TEXT PRIMARY KEY,
     state TEXT NOT NULL CHECK(state IN ('started','verified','failed')),
     result_code TEXT,
     expected_bytes BIGINT,
     bytes_copied BIGINT NOT NULL DEFAULT 0,
     parts_copied INTEGER NOT NULL DEFAULT 0,
     verified_sha256 CHAR(64),
     object_key TEXT,
     started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     finished_at TIMESTAMPTZ
   )`);
   // Support one-shot rows created by the previous feature iteration.
   await pool.query(`ALTER TABLE blofy_content_hub_pilot_runs
     ADD COLUMN IF NOT EXISTS expected_bytes BIGINT,
     ADD COLUMN IF NOT EXISTS bytes_copied BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS parts_copied INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS verified_sha256 CHAR(64),
     ADD COLUMN IF NOT EXISTS object_key TEXT`);
   const r=await pool.query(`INSERT INTO blofy_content_hub_pilot_runs
     (run_id,state,expected_bytes) VALUES ($1,'started',$2)
     ON CONFLICT DO NOTHING RETURNING run_id`,[runId,expectedBytes]);
   return r.rowCount===1;
  },
  async progressPilotRun(runId,{bytesUploaded,partsUploaded}={}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||''))||
     !Number.isSafeInteger(bytesUploaded)||bytesUploaded<0||
     !Number.isSafeInteger(partsUploaded)||partsUploaded<0)
    throw Error('content_hub_invalid_pilot_progress');
   const r=await pool.query(`UPDATE blofy_content_hub_pilot_runs
     SET bytes_copied=GREATEST(bytes_copied,$2),
         parts_copied=GREATEST(parts_copied,$3)
     WHERE run_id=$1 AND state='started' AND $2<=expected_bytes
     RETURNING run_id`,[runId,bytesUploaded,partsUploaded]);
   if(r.rowCount!==1)throw Error('content_hub_pilot_progress_unavailable');
  },
  async finishPilotRun(runId,{status,code,bytes,sha256,objectKey}={}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||''))||
     !['verified','failed'].includes(status)||
     !/^[a-z0-9_]{1,80}$/.test(String(code||'')))
    throw Error('content_hub_invalid_pilot_result');
   if(status==='verified'&&(!Number.isSafeInteger(bytes)||bytes<=0||
     !/^[a-f0-9]{64}$/.test(String(sha256||''))||
     !/^saleh\/movie\/[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,128}\.(?:mp4|mkv|ts|avi)$/.test(String(objectKey||''))))
    throw Error('content_hub_invalid_pilot_proof');
   const r=await pool.query(`UPDATE blofy_content_hub_pilot_runs
     SET state=$2,result_code=$3,finished_at=NOW(),
         bytes_copied=CASE WHEN $2='verified' THEN $4 ELSE bytes_copied END,
         verified_sha256=CASE WHEN $2='verified' THEN $5 ELSE NULL END,
         object_key=CASE WHEN $2='verified' THEN $6 ELSE NULL END
     WHERE run_id=$1 AND state='started'
       AND ($2='failed' OR expected_bytes=$4)
     RETURNING run_id`,
     [runId,status,code,bytes||null,sha256||null,objectKey||null]);
   if(r.rowCount!==1)throw Error('content_hub_pilot_finalize_unavailable');
  },
  async getPilotStatus(runId){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||'')))return null;
   const r=await pool.query(`SELECT state,result_code,
     expected_bytes,bytes_copied,parts_copied,started_at,finished_at
     FROM blofy_content_hub_pilot_runs WHERE run_id=$1`,[runId]);
   const row=r.rows?.[0];if(!row)return null;
   const total=Number(row.expected_bytes||0),done=Number(row.bytes_copied||0);
   return {state:row.state,code:row.result_code||null,
      expectedBytes:total,bytesCopied:done,partsCopied:row.parts_copied,
      percent:total>0?Math.min(100,Math.floor(done/total*100)):0,
      startedAt:row.started_at,finishedAt:row.finished_at};
  },
  async getVerifiedPilotObject(runId){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||'')))return null;
   const r=await pool.query(`SELECT object_key,expected_bytes,verified_sha256
      FROM blofy_content_hub_pilot_runs
      WHERE run_id=$1 AND state='verified' AND object_key IS NOT NULL`,[runId]);
   const row=r.rows?.[0];
   return row?{key:row.object_key,bytes:Number(row.expected_bytes),
     sha256:row.verified_sha256}:null;
  },
  async close(){await pool.end()}
 };
}
