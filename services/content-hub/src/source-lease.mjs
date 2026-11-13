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
  // Admin-only storage accounting from verified pilot records. This is not
  // an S3 invoice or a scan of other private bucket objects.
  async storageAccounting(){
   const r=await pool.query(`SELECT
      COUNT(*) FILTER (WHERE state='verified')::int AS verified_count,
      COALESCE(SUM(expected_bytes) FILTER (WHERE state='verified'),0)::text AS verified_bytes,
      COUNT(*) FILTER (WHERE state='started')::int AS active_count,
      COUNT(*) FILTER (WHERE state='failed')::int AS failed_count
     FROM blofy_content_hub_pilot_runs`).catch(error=>{
      if(error?.code==='42P01')return {rows:[{
       verified_count:0,verified_bytes:'0',active_count:0,failed_count:0
      }]};
      throw error;
     });
   const row=r.rows?.[0]||{};
   return {verifiedCount:Number(row.verified_count||0),
    verifiedBytes:Number(row.verified_bytes||0),
    activeCount:Number(row.active_count||0),
    failedCount:Number(row.failed_count||0),
    scope:'verified_pilot_records_only'};
  },
  async listPilotRuns({limit=20}={}){
   const safeLimit=Math.max(1,Math.min(50,Number(limit)||20));
   const r=await pool.query(`SELECT run_id FROM blofy_content_hub_pilot_runs
     ORDER BY started_at DESC LIMIT $1`,[safeLimit]).catch(error=>{
      if(error?.code==='42P01')return {rows:[]};
      throw error;
     });
   const list=[];
   for(const row of r.rows||[]){
     const entry=await this.getPilotStatus(row.run_id);
     if(entry)list.push({...entry,runId:row.run_id});
   }
   return list;
  },
  // Resumable chunk manifest: unlike incomplete multipart uploads every
  // recorded chunk is already a verified, complete private S3 object.
  async loadChunkedRun({runId,sourceId,mediaId,gatewayId,extension,expectedBytes}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId)||!
    /^[a-f0-9-]{36}$/i.test(sourceId)||!
    /^[A-Za-z0-9_-]{1,128}$/.test(String(mediaId))||
    !Number.isSafeInteger(gatewayId)||gatewayId<1||
    !['mkv','mp4','ts','avi'].includes(extension)||
    !Number.isSafeInteger(expectedBytes)||expectedBytes<8*1024*1024||
    expectedBytes>4*1024**3)throw Error('invalid_chunked_config');
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_content_hub_chunk_runs (
     run_id TEXT PRIMARY KEY,
     state TEXT NOT NULL CHECK(state IN ('staged','verified','failed')),
     source_id UUID NOT NULL,
     media_id TEXT NOT NULL,
     gateway_id INTEGER NOT NULL,
     extension TEXT NOT NULL,
     expected_bytes BIGINT NOT NULL,
     bytes_copied BIGINT NOT NULL DEFAULT 0,
     validator TEXT,
     parts JSONB NOT NULL DEFAULT '[]'::jsonb,
     verified_sha256 CHAR(64),
     error_code TEXT,
     started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`);
   await pool.query(`INSERT INTO blofy_content_hub_chunk_runs
     (run_id,state,source_id,media_id,gateway_id,extension,expected_bytes)
     VALUES ($1,'staged',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
     [runId,sourceId,mediaId,gatewayId,extension,expectedBytes]);
   const row=(await pool.query(`SELECT * FROM blofy_content_hub_chunk_runs
     WHERE run_id=$1`,[runId])).rows?.[0];
   if(!row||row.source_id!==sourceId||row.media_id!==mediaId||
     Number(row.gateway_id)!==gatewayId||row.extension!==extension||
     Number(row.expected_bytes)!==expectedBytes||
     !Array.isArray(row.parts)||
     Number(row.bytes_copied)!==row.parts.reduce((x,y)=>x+Number(y.bytes||0),0))
    throw Error('chunked_run_scope_conflict');
   return {state:row.state,validator:row.validator||null,
     parts:row.parts.map(x=>({...x,bytes:Number(x.bytes),
       partNumber:Number(x.partNumber)}))};
  },
  async recordChunk(runId,{partNumber,key,bytes,sha256,validator}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId)||!Number.isSafeInteger(partNumber)||
     partNumber<1||partNumber>1024||
     !/^saleh\/movie\/[a-f0-9-]{36}\/batch_[a-f0-9]{24}_part_[0-9]{6}\.(?:mp4|mkv|avi|ts)$/.test(key)||
     !Number.isSafeInteger(bytes)||bytes<1||bytes>8*1024*1024||
     !/^[a-f0-9]{64}$/.test(sha256)||typeof validator!=='string'||
     !validator.trim()||validator.length>140)
    throw Error('invalid_chunk_acknowledgement');
   const res=await pool.query(`UPDATE blofy_content_hub_chunk_runs
      SET parts=parts||$3::jsonb,bytes_copied=bytes_copied+$4,
      validator=COALESCE(validator,$5),updated_at=NOW()
      WHERE run_id=$1 AND state='staged'
      AND jsonb_array_length(parts)=$2-1
      AND (validator IS NULL OR validator=$5)
      AND bytes_copied+$4<=expected_bytes
      RETURNING run_id`,
     [runId,partNumber,JSON.stringify([{partNumber,key,bytes,sha256}]),
      bytes,validator]);
   if(res.rowCount!==1)throw Error('chunk_checkpoint_rejected');
   return {key};
  },
  async verifyChunkedRun(runId,{sha256}={}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId)||
     !/^[a-f0-9]{64}$/.test(String(sha256)))
    throw Error('invalid_full_movie_digest');
   const res=await pool.query(`UPDATE blofy_content_hub_chunk_runs
     SET state='verified',verified_sha256=$2,updated_at=NOW()
     WHERE run_id=$1 AND state='staged' AND bytes_copied=expected_bytes
     RETURNING run_id`,[runId,sha256]);
   if(res.rowCount!==1)throw Error('final_movie_not_checkpointed');
  },
  async failChunkedRun(runId,{code}={}){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId)||
     !/^[a-z0-9_]{1,80}$/.test(String(code||'')))
    throw Error('chunked_failure_invalid');
   await pool.query(`UPDATE blofy_content_hub_chunk_runs
      SET state='failed',error_code=$2,updated_at=NOW()
      WHERE run_id=$1 AND state='staged'`,[runId,code]);
  },
  async getVerifiedChunkedObject(runId){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||'')))return null;
   const result=await pool.query(`SELECT source_id,extension,expected_bytes,
       parts,verified_sha256 FROM blofy_content_hub_chunk_runs
       WHERE run_id=$1 AND state='verified'`,[runId]);
   const row=result.rows?.[0];
   if(!row||!Array.isArray(row.parts)||!
      /^[a-f0-9]{64}$/.test(String(row.verified_sha256||'')))return null;
   const bytes=Number(row.expected_bytes);
   const parts=row.parts.map(x=>({
     key:String(x.key||''),bytes:Number(x.bytes),
     sha256:String(x.sha256||''),partNumber:Number(x.partNumber)
   }));
   if(!Number.isSafeInteger(bytes)||bytes<1||bytes>4*1024**3||
     parts.reduce((sum,x)=>sum+x.bytes,0)!==bytes||
     parts.some((part,i)=>part.partNumber!==i+1||
       !Number.isSafeInteger(part.bytes)||part.bytes<1||
       part.bytes>8*1024*1024||
       !/^[a-f0-9]{64}$/.test(part.sha256)||
       !/^saleh\/movie\/[a-f0-9-]{36}\/batch_[a-f0-9]{24}_part_[0-9]{6}\.(?:mkv|mp4|ts|avi)$/.test(part.key)))
    return null;
   return {kind:'chunked',bytes,extension:row.extension,
     sha256:row.verified_sha256,parts};
  },
  async listChunkedRuns({limit=20}={}){
   const n=Math.max(1,Math.min(50,Number(limit)||20));
   const result=await pool.query(`SELECT run_id,state,expected_bytes,
      bytes_copied,jsonb_array_length(parts) AS chunks,
      error_code,started_at,updated_at
      FROM blofy_content_hub_chunk_runs
      ORDER BY updated_at DESC LIMIT $1`,[n]).catch(e=>{
        if(e?.code==='42P01')return {rows:[]};throw e;
      });
   return (result.rows||[]).map(row=>({
    runId:row.run_id,state:row.state,
    expectedBytes:Number(row.expected_bytes),
    bytesCopied:Number(row.bytes_copied),
    percent:Math.floor(Number(row.bytes_copied)/
      Number(row.expected_bytes)*100),
    partsCopied:Number(row.chunks),code:row.error_code||null,
    startedAt:row.started_at,finishedAt:row.state==='verified'?
      row.updated_at:null,format:'private_chunks'
   }));
  },
  async chunkedStorageAccounting(){
   const res=await pool.query(`SELECT
    COUNT(*) FILTER(WHERE state='verified')::int AS verified_count,
    COALESCE(SUM(expected_bytes) FILTER(WHERE state='verified'),0)::text
      AS verified_bytes,
    COUNT(*) FILTER(WHERE state='staged')::int AS active_count,
    COUNT(*) FILTER(WHERE state='failed')::int AS failed_count,
    COALESCE(SUM(bytes_copied),0)::text AS stored_bytes
    FROM blofy_content_hub_chunk_runs`).catch(e=>{
      if(e?.code==='42P01')return {rows:[{}]};throw e;
    });
   const row=res.rows?.[0]||{};
   return {verifiedCount:Number(row.verified_count||0),
    verifiedBytes:Number(row.verified_bytes||0),
    activeCount:Number(row.active_count||0),
    failedCount:Number(row.failed_count||0),
    storedBytes:Number(row.stored_bytes||0)};
  },
  // One operator-approved startup request can never be replayed on
  // container restart or a deploy. A fresh token needs explicit approval.
  async claimBatchBootOnce(token,runId){
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(token||''))||
     !/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||'')))
    throw Error('invalid_one_time_batch_token');
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_content_hub_batch_boot_claims (
      event_token TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`);
   const claimed=await pool.query(`INSERT INTO blofy_content_hub_batch_boot_claims
      (event_token,run_id) VALUES ($1,$2) ON CONFLICT DO NOTHING
      RETURNING event_token`,[token,runId]);
   return claimed.rowCount===1;
  },
  async close(){await pool.end()}
 };
}
