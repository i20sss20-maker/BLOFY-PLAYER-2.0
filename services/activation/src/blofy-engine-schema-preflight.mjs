import {ensureEngineIngressGate,createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {ensureLinodeFeedLedger} from './linode-feed-ledger.mjs';
// Prepare only additive empty tables. No change to existing subscriptions,
// provider credentials, ingress flags, traffic, or reservation ownership.
// One migration transaction across portal replicas.
export async function prepareEngineSchema(pool,{sourceId}={}){
 if(typeof sourceId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sourceId))return {ok:false,code:'source_not_configured'};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',['blofy-engine-schema-v1']);
  const {rows:[source]}=await c.query('SELECT enabled FROM blofy_xtream_servers WHERE id=$1',[sourceId]);
  if(source?.enabled!==true){await c.query('ROLLBACK');return {ok:false,code:'source_not_enabled'}}
  await ensureLinodeFeedLedger(c);
  await ensureEngineIngressGate(c);
  await c.query('COMMIT');
 }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
 const gate=createEngineIngressGate(pool,{sourceId,enabled:true});
 const mode=await gate.readMode();
 if(mode.ok)return {ok:mode.mode==='legacy',code:mode.mode==='legacy'?'schema_ready':'existing_nonlegacy_gate',mode:mode.mode};
 const initialized=await gate.initialize();
 if(initialized.ok)return {ok:true,code:'schema_ready',mode:'legacy'};
 const check=await gate.readMode();
 return {ok:check.ok&&check.mode==='legacy',code:check.ok&&check.mode==='legacy'?'schema_ready':'gate_unknown',mode:check.mode??null};
}

export async function readApprovedEngineSource(pool,env=process.env){
 const name=String(env.BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME||'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(name)||env.BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED!=='1'||env.BLOFY_STREAM_SHARED_LIVE_CANARY!=='1'||env.BLOFY_STREAM_LICENSED_LIVE_PRODUCTION!=='1')return null;
 const {rows}=await pool.query(`SELECT id,enabled,publish_catalog,account_info->>'isRestreamer' AS restreamer,
 account_info->>'maxConnections' AS quota FROM blofy_xtream_servers WHERE lower(btrim(name))=$1 AND deletion_requested_at IS NULL LIMIT 2`,[name]);
 const r=rows[0];
 if(rows.length!==1||r.enabled!==true||r.publish_catalog!==true)return null;
 const manual=env.BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED==='1'&&name===String(env.BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME||'').trim().toLowerCase();
 if(r.restreamer!=='true'&&!manual)return null;
 if(env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID&&env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID!==r.id)return null;
 const quota=typeof r.quota==='string'&&/^[1-9][0-9]*$/.test(r.quota)?Number(r.quota):null;
 return {sourceId:r.id,reportedMaxConnections:Number.isSafeInteger(quota)?quota:null};
}

export async function resolveEngineIngressSource(pool,env=process.env){
 return (await readApprovedEngineSource(pool,env))?.sourceId??null;
}

// The existing single-feed canary still requires its exact quota. The shared
// ingress fence must continue tracking the source across provider plan changes.
export async function resolveApprovedEngineSource(pool,env=process.env){
 const source=await readApprovedEngineSource(pool,env);
 return source?.reportedMaxConnections===1?source.sourceId:null;
}
