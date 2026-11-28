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
 // Durable relay ownership is separate from the leased-worker gate.
 // Null/disabled leaves the existing production relay path unchanged.
 await db.query("ALTER TABLE blofy_engine_ingress_gate ADD COLUMN IF NOT EXISTS relay_owner text");
 await db.query("ALTER TABLE blofy_engine_ingress_gate ADD COLUMN IF NOT EXISTS relay_next_owner text");
 await db.query("ALTER TABLE blofy_engine_legacy_holds ADD COLUMN IF NOT EXISTS relay_engine text");

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
  // For the existing portable relay path: the authenticated node, not a
  // caller-supplied hostname, owns admission. A standby cannot open a
  // source socket even if an old ticket is still valid.
  async enterOwnedRelay(holdId,engineId){
   if(!valid(holdId)||!['hostbrr','linode'].includes(engineId))return denied('invalid_hold');
   return tx(async(c,row)=>{
    if(row?.mode!=='legacy'||row.relay_owner!==engineId)return denied('relay_not_owner');
    const r=await c.query('INSERT INTO blofy_engine_legacy_holds(source_id,hold_id,relay_engine) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING hold_id',[sourceId,holdId,engineId]);
    return r.rowCount===1?{ok:true,holdId}:denied('hold_replayed');
   });
  },
  async closeOwnedRelay(holdId,engineId,{abandon=false}={}){
   if(!valid(holdId)||!['hostbrr','linode'].includes(engineId))return denied('invalid_hold');
   return tx(async(c,row)=>{
    if(!row)return denied('gate_missing');
    // A delayed cleanup is allowed for its original node only. An ambiguous
    // enter that never opened upstream may create a matching tombstone.
    const r=abandon?await c.query(`INSERT INTO blofy_engine_legacy_holds(source_id,hold_id,relay_engine,closed,closed_at)
     VALUES($1,$2,$3,true,now()) ON CONFLICT(hold_id) DO UPDATE
     SET closed=true,closed_at=COALESCE(blofy_engine_legacy_holds.closed_at,EXCLUDED.closed_at)
     WHERE blofy_engine_legacy_holds.source_id=EXCLUDED.source_id AND blofy_engine_legacy_holds.relay_engine=EXCLUDED.relay_engine`,[sourceId,holdId,engineId]):
     await c.query('UPDATE blofy_engine_legacy_holds SET closed=true,closed_at=COALESCE(closed_at,now()) WHERE source_id=$1 AND hold_id=$2 AND relay_engine=$3',[sourceId,holdId,engineId]);
    return r.rowCount===1?{ok:true}:denied('hold_not_owned');
   });
  },
  // Persist the intended destination before any drain. Compare-and-set under
  // the shared source lock prevents competing controllers choosing a new owner.
  async readRelayOwnerState(){return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   const {rows:[n]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
   return {ok:true,mode:row.mode,owner:row.relay_owner??null,nextOwner:row.relay_next_owner??null,
     epoch:new Date(row.updated_at).getTime(),openHolds:n.n};
  })},
  async beginRelayDrain({expectedOwner=null,nextOwner}={}){
   if(![null,'hostbrr','linode'].includes(expectedOwner)||!['hostbrr','linode'].includes(nextOwner)||expectedOwner===nextOwner)
    return denied('invalid_relay_transition');
   return tx(async(c,row)=>{
    if(row?.mode!=='legacy'||(row.relay_owner??null)!==expectedOwner||row.relay_next_owner)
      return denied('relay_transition_conflict');
    const {rows:[feed]}=await c.query('SELECT state FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
    if(feed&&feed.state!=='released')return denied('reservation_unresolved');
    const {rows:[updated]}=await c.query("UPDATE blofy_engine_ingress_gate SET mode='draining',relay_next_owner=$2,updated_at=clock_timestamp() WHERE source_id=$1 RETURNING updated_at",[sourceId,nextOwner]);
    return {ok:true,mode:'draining',owner:expectedOwner,nextOwner,epoch:new Date(updated.updated_at).getTime()};
   });
  },
  async cancelRelayDrain({expectedOwner,nextOwner,epoch}={}){
   if(!['hostbrr','linode'].includes(expectedOwner)||!['hostbrr','linode'].includes(nextOwner)||!Number.isSafeInteger(epoch))
    return denied('invalid_relay_transition');
   return tx(async(c,row)=>{
    if(row?.mode!=='draining'||row.relay_owner!==expectedOwner||row.relay_next_owner!==nextOwner||new Date(row.updated_at).getTime()!==epoch)
      return denied('relay_transition_conflict');
    const {rows:[feed]}=await c.query('SELECT state FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
    if(feed&&feed.state!=='released')return denied('reservation_unresolved');
    await c.query("UPDATE blofy_engine_ingress_gate SET mode='legacy',relay_next_owner=NULL,updated_at=clock_timestamp() WHERE source_id=$1",[sourceId]);
    return {ok:true,mode:'legacy',relayOwner:expectedOwner};
   });
  },
  // Internal orchestration only. Change the selected portable relay under
  // the same source lock as all admissions. A health failure alone is never
  // evidence of release. No external endpoint is allowed to supply proof.
  async commitRelayOwner({expectedOwner=null,nextOwner,proof}={}){
   if(![null,'hostbrr','linode'].includes(expectedOwner)||!['hostbrr','linode'].includes(nextOwner)||expectedOwner===nextOwner)
    return denied('invalid_relay_transition');
   return tx(async(c,row)=>{
    if(row?.mode!=='draining'||(row.relay_owner??null)!==expectedOwner||row.relay_next_owner!==nextOwner)
     return denied('relay_transition_conflict');
    const {rows:[time]}=await c.query('SELECT clock_timestamp() now');
    const now=new Date(time.now).getTime(),drainStartedAt=new Date(row.updated_at).getTime();
    if(proof?.sourceId!==sourceId||proof?.previousOwner!==expectedOwner||
       proof?.authoritative!==true||proof?.scope!=='all_paths'||
       proof?.activeConnections!==0||proof?.maxConnections!==1||
       !Number.isSafeInteger(proof.observedAt)||!Number.isSafeInteger(drainStartedAt)||
       proof.drainStartedAt!==drainStartedAt||proof.observedAt<drainStartedAt||
       proof.observedAt<now-10000||proof.observedAt>now+2000)
      return denied('external_fence_unconfirmed');
    const {rows:[n]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
    if(n.n!==0)return denied('legacy_holds_open');
    const {rows:[feed]}=await c.query('SELECT state FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
    if(feed&&feed.state!=='released')return denied('reservation_unresolved');
    await c.query("UPDATE blofy_engine_ingress_gate SET mode='legacy',relay_owner=$2,relay_next_owner=NULL,reservation_id=NULL,engine_id=NULL,updated_at=now() WHERE source_id=$1",[sourceId,nextOwner]);
    return {ok:true,mode:'legacy',relayOwner:nextOwner};
   });
  },
  async closeLegacy(holdId){if(!valid(holdId))return denied('invalid_hold');return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   const r=await c.query('UPDATE blofy_engine_legacy_holds SET closed=true,closed_at=COALESCE(closed_at,now()) WHERE source_id=$1 AND hold_id=$2',[sourceId,holdId]);
   return r.rowCount===1?{ok:true}:denied('hold_not_found');
  })},
  // Used only when the caller never opened upstream because enter was not
  // acknowledged. Keep a tombstone even if the delayed enter has yet to arrive.
  async abandonLegacy(holdId){if(!valid(holdId))return denied('invalid_hold');return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   const r=await c.query(`INSERT INTO blofy_engine_legacy_holds(source_id,hold_id,closed,closed_at)
    VALUES($1,$2,true,now()) ON CONFLICT(hold_id) DO UPDATE
    SET closed=true,closed_at=COALESCE(blofy_engine_legacy_holds.closed_at,EXCLUDED.closed_at)
    WHERE blofy_engine_legacy_holds.source_id=EXCLUDED.source_id`,[sourceId,holdId]);
   return r.rowCount===1?{ok:true}:denied('hold_conflict');
  })},
  async beginDrain(){return tx(async(c,row)=>{
   if(row?.mode!=='legacy'||row.relay_owner||row.relay_next_owner)return denied('not_legacy');
   await c.query("UPDATE blofy_engine_ingress_gate SET mode='draining',updated_at=now() WHERE source_id=$1",[sourceId]);
   return {ok:true,mode:'draining'};
  })},
  // Abort an incomplete drain only before an engine has taken ownership.
  // A pending or unknown reservation must first be reconciled independently.
  async cancelDrain({expectedDrainStartedAt}={}){return tx(async(c,row)=>{
   if(row?.mode!=='draining'||row.relay_next_owner)return denied('not_draining');
   if(expectedDrainStartedAt!==undefined&&(!Number.isSafeInteger(expectedDrainStartedAt)||new Date(row.updated_at).getTime()!==expectedDrainStartedAt))return denied('drain_epoch_changed');
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
  async readDrain({includeOpenHoldIds=false}={}){return tx(async(c,row)=>{
   if(!row)return denied('gate_missing');
   if(includeOpenHoldIds&&row.mode==='draining'){
    const {rows}=await c.query('SELECT hold_id FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed ORDER BY hold_id',[sourceId]);
    return {ok:true,mode:row.mode,registeredLegacyHolds:rows.length,allPathsDrained:false,
     drainStartedAt:new Date(row.updated_at).getTime(),openHoldIds:rows.map(hold=>hold.hold_id)};
   }
   const {rows:[r]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
   return {ok:true,mode:row.mode,registeredLegacyHolds:r.n,allPathsDrained:false};
  })},
  // Never promote based on registered holds alone. Coverage and independent
  // provider observation are required from the trusted cutover orchestrator.
  async promote({reservationId,engineId,proof,legacyHoldsToReconcile=null}={}){return tx(async(c,row)=>{
   if(row?.mode!=='draining'||row.relay_next_owner||row.relay_owner||!valid(reservationId)||!['hostbrr','linode'].includes(engineId))return denied('not_draining');
   const {rows:[time]}=await c.query('SELECT clock_timestamp() now');
   const now=new Date(time.now).getTime();
   if(proof?.sourceId!==sourceId||proof?.authoritative!==true||proof.scope!=='all_paths'||proof.activeConnections!==0||proof.maxConnections!==1||!Number.isSafeInteger(proof.observedAt)||proof.observedAt<now-10000||proof.observedAt>now+2000)return denied('external_fence_unconfirmed');
   const {rows:[n]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
   if(n.n!==0){
    // Historical holds lack owner metadata. Recover only an exact set from
    // the current drain, after a trusted observer fenced every path and
    // observed zero provider sockets. Keep existing rows for audit.
    if(!Array.isArray(legacyHoldsToReconcile)||legacyHoldsToReconcile.length!==n.n||
       !legacyHoldsToReconcile.every(valid)||new Set(legacyHoldsToReconcile).size!==n.n||
       proof.drainStartedAt!==new Date(row.updated_at).getTime()||proof.observedAt<proof.drainStartedAt)
     return denied('legacy_holds_open');
    const {rows:[matched]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed AND hold_id=ANY($2::uuid[])',[sourceId,legacyHoldsToReconcile]);
    if(matched.n!==n.n)return denied('legacy_hold_snapshot_changed');
   }
   const {rows:[feed]}=await c.query('SELECT * FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
   if(!feed||feed.state!=='pending'||feed.reservation_id!==reservationId||feed.engine_id!==engineId)return denied('reservation_mismatch');
   if(n.n!==0){
    const closed=await c.query('UPDATE blofy_engine_legacy_holds SET closed=true,closed_at=clock_timestamp() WHERE source_id=$1 AND NOT closed AND hold_id=ANY($2::uuid[])',[sourceId,legacyHoldsToReconcile]);
    if(closed.rowCount!==n.n)throw Error('legacy_hold_snapshot_changed');
   }
   await c.query("UPDATE blofy_engine_ingress_gate SET mode='engine',reservation_id=$2,engine_id=$3,updated_at=now() WHERE source_id=$1",[sourceId,reservationId,engineId]);
   return n.n===0?{ok:true,mode:'engine'}:{ok:true,mode:'engine',reconciledLegacyHolds:n.n};
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
