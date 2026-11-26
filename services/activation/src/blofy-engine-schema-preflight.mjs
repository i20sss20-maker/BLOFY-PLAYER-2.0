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
