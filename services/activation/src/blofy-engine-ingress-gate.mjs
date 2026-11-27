// Shared durable ingress gate for the legacy/new media planes. A legacy
// owner must register BEFORE opening upstream, and close only AFTER the
// upstream socket is physically closed. There is no timed auto-release.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const valid=x=>typeof x==='string'&&uuid.test(x);
export async function ensureEngineIngressGate(db){
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_engine_ingress_gate(
 source_id uuid PRIMARY KEY, mode text NOT NULL CHECK(mode IN ('legacy','draining','engine','unknown')),
 reservation_id uuid, engine_id text, updated_at timestamptz NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_engine_legacy_holds(
 source_id uuid NOT NULL, hold_id uuid PRIMARY KEY, closed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz)`);
 await db.query('CREATE INDEX IF NOT EXISTS blofy_engine_legacy_holds_active ON blofy_engine_legacy_holds(source_id) WHERE NOT closed');
}
export function createEngineIngressGate(pool,{sourceId,enabled=false}={}){
 const denied=reason=>({ok:false,reason});
 const tx=async(fn)=>{
  if(!enabled||!valid(sourceId))return denied('disabled');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   // Identical lock to linode-feed-ledger. All participants must share DB.
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',['blofy-linode-feed:'+sourceId]);
   const {rows:[row]}=await c.query('SELECT * FROM blofy_engine_ingress_gate WHERE source_id=$1',[sourceId]);
   const r=await fn(c,row);
   await c.query('COMMIT');return r;
  }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
 };
 return {
  async initialize(){return tx(async(c,row)=>{
   if(row)return denied('already_initialized');
   await c.query("INSERT INTO blofy_engine_ingress_gate(source_id,mode) VALUES($1,'legacy')",[sourceId]);
   return {ok:true,mode:'legacy'};
  })},
  async enterLegacy(holdId){if(!valid(holdId))return denied('invalid_hold');return tx(async(c,row)=>{
   if(row?.mode!=='legacy')return denied('legacy_fenced');
   const r=await c.query('INSERT INTO blofy_engine_legacy_holds(source_id,hold_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING hold_id',[sourceId,holdId]);
   return r.rowCount===1?{ok:true,holdId}:denied('hold_replayed');
  })},
  async closeLegacy(holdId){if(!valid(holdId))return denied('invalid_hold');return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   const r=await c.query('UPDATE blofy_engine_legacy_holds SET closed=true,closed_at=now() WHERE source_id=$1 AND hold_id=$2 AND NOT closed',[sourceId,holdId]);
   return r.rowCount===1?{ok:true}:denied('hold_not_open');
  })},
  async beginDrain(){return tx(async(c,row)=>{
   if(row?.mode!=='legacy')return denied('not_legacy');
   await c.query("UPDATE blofy_engine_ingress_gate SET mode='draining',updated_at=now() WHERE source_id=$1",[sourceId]);
   return {ok:true,mode:'draining'};
  })},
  // Abort an incomplete drain only before an engine has taken ownership.
  // A pending or unknown reservation must first be reconciled independently.
  async cancelDrain(){return tx(async(c,row)=>{
   if(row?.mode!=='draining')return denied('not_draining');
   const {rows:[feed]}=await c.query('SELECT state FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
   if(feed&&feed.state!=='released')return denied('reservation_unresolved');
   await c.query("UPDATE blofy_engine_ingress_gate SET mode='legacy',reservation_id=NULL,engine_id=NULL,updated_at=now() WHERE source_id=$1",[sourceId]);
   return {ok:true,mode:'legacy'};
  })},
  async readMode(){return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   const {rows:[time]}=await c.query('SELECT clock_timestamp() now');
   return {ok:true,mode:row.mode,observedAt:new Date(time.now).getTime()};
  })},
  async readDrain(){return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   const {rows:[r]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
   return {ok:true,mode:row.mode,registeredLegacyHolds:r.n,allPathsDrained:false};
  })},
  // Never promote based on registered holds alone. Coverage and independent
  // provider observation are required from the trusted cutover orchestrator.
  async promote({reservationId,engineId,proof}={}){return tx(async(c,row)=>{
   if(row?.mode!=='draining'||!valid(reservationId)||!['hostbrr','linode'].includes(engineId))return denied('not_draining');
   const {rows:[time]}=await c.query('SELECT clock_timestamp() now');
   const now=new Date(time.now).getTime();
   if(proof?.sourceId!==sourceId||proof?.authoritative!==true||proof.scope!=='all_paths'||proof.activeConnections!==0||proof.maxConnections!==1||!Number.isSafeInteger(proof.observedAt)||proof.observedAt<now-10000||proof.observedAt>now+2000)return denied('external_fence_unconfirmed');
   const {rows:[n]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
   if(n.n!==0)return denied('legacy_holds_open');
   const {rows:[feed]}=await c.query('SELECT * FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
   if(!feed||feed.state!=='pending'||feed.reservation_id!==reservationId||feed.engine_id!==engineId)return denied('reservation_mismatch');
   await c.query("UPDATE blofy_engine_ingress_gate SET mode='engine',reservation_id=$2,engine_id=$3,updated_at=now() WHERE source_id=$1",[sourceId,reservationId,engineId]);
   return {ok:true,mode:'engine'};
  })},
  async readFence(identity){return tx(async(c,row)=>{
   if(row?.mode!=='engine'||identity?.sourceId!==sourceId||row.reservation_id!==identity.reservationId||row.engine_id!==identity.engineId)return null;
   const {rows:[r]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
   if(r.n!==0)return null;
   const {rows:[time]}=await c.query('SELECT clock_timestamp() now');
   const now=new Date(time.now).getTime();
   // Gate state proves participating ingress is fenced. It does not prove
   // external clients are participating. Caller still needs verified coverage.
   return {sourceId,reservationId:row.reservation_id,engineId:row.engine_id,observedAt:now,expiresAt:now+60000,registeredIngressFenced:true};
  })},
  async restoreLegacy(){return tx(async(c,row)=>{
   if(row?.mode!=='engine')return denied('not_engine');
   const {rows:[feed]}=await c.query('SELECT * FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
   if(!feed||feed.state!=='released'||feed.reservation_id!==row.reservation_id||feed.engine_id!==row.engine_id)return denied('engine_release_unconfirmed');
   await c.query("UPDATE blofy_engine_ingress_gate SET mode='legacy',reservation_id=NULL,engine_id=NULL,updated_at=now() WHERE source_id=$1",[sourceId]);
   return {ok:true,mode:'legacy'};
  })}
 };
}
