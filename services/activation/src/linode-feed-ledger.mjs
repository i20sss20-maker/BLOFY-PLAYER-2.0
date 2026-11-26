import {randomUUID} from 'node:crypto';
import {signLiveLease} from './blofy-live-worker-lease.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const channel=/^[1-9][0-9]{0,14}$/;
const blocked=reason=>({ok:false,reason});
// Isolated ledger, not an all-paths capacity authority. Legacy ingress must
// participate in the same reservation protocol before using it commercially.
// Expiration is NOT proof that a provider socket closed.
export async function ensureLinodeFeedLedger(db){
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_linode_feed_ledger (
 source_id uuid PRIMARY KEY,
 channel_id text NOT NULL,
 request_id uuid NOT NULL,
 reservation_id uuid NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('pending','ready','unknown','released')),
 generation text,
 updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 await db.query("ALTER TABLE blofy_linode_feed_ledger ADD COLUMN IF NOT EXISTS engine_id text NOT NULL DEFAULT 'linode' CHECK (engine_id IN ('linode','hostbrr'))");
 await db.query('ALTER TABLE blofy_linode_feed_ledger ADD COLUMN IF NOT EXISTS worker_lease_sequence bigint NOT NULL DEFAULT 0');
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_linode_feed_requests (
 request_id uuid PRIMARY KEY, source_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_linode_viewer_sessions (
 session_id uuid PRIMARY KEY, source_id uuid NOT NULL, reservation_id uuid NOT NULL,
 account_id uuid NOT NULL, channel_id text NOT NULL, generation text NOT NULL,
 expires_at timestamptz NOT NULL, closed boolean NOT NULL DEFAULT false
 )`);
 await db.query('CREATE INDEX IF NOT EXISTS blofy_linode_viewers_reservation_expiry_idx ON blofy_linode_viewer_sessions(reservation_id, expires_at)');
}
export function createLinodeFeedLedger(pool,env=process.env){
 const enabled=sourceId=>env.BLOFY_LINODE_FEED_LEDGER==='1'&&
   typeof sourceId==='string'&&uuid.test(sourceId)&&sourceId===sourceId.toLowerCase()&&sourceId===env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID;
 const engineAllowed=id=>id==='linode'||(id==='hostbrr'&&env.BLOFY_HOSTBRR_FEED_LEDGER==='1');
 async function tx(sourceId,fn){
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',['blofy-linode-feed:'+sourceId]);
   const {rows}=await c.query('SELECT * FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
   const result=await fn(c,rows[0]);
   await c.query('COMMIT');
   return result;
  }catch(e){try{await c.query('ROLLBACK');}catch{}throw e;}
  finally{c.release();}
 }
 return {
  // Internal locked snapshot, not an admission decision. reserve/attach/transition
  // must recheck state under the same source lock after the planner returns.
  async readRoutingState({sourceId}={}){
   if(!enabled(sourceId))return null;
   return tx(sourceId,async(c,row)=>{
    if(!row)return {sourceId,state:'empty'};
    if(!engineAllowed(row.engine_id))return null;
    return {sourceId,state:row.state,engineId:row.engine_id,
     channelId:row.channel_id,reservationId:row.reservation_id,generation:row.generation,
     // Only the trusted transition writes released; timestamps alone never do.
     releaseConfirmed:row.state==='released'};
   });
  },
  // Issue only while holding the SAME source lock as reserve and transition.
  // A caller must supply a separately enforced source-wide ingress fence;
  // a maintenance flag, heartbeat, or provider zero alone is not that proof.
  async issueWorkerLease({sourceId,reservationId,engineId,channelId,fence,signingKey}={}){
   if(env.BLOFY_ENGINE_RENEWABLE_LEASE!=='1'||!enabled(sourceId)||!engineAllowed(engineId)||
      !uuid.test(reservationId??'')||!channel.test(channelId??''))return blocked('lease_disabled_or_invalid');
   return tx(sourceId,async(c,row)=>{
    if(!row||!['pending','ready'].includes(row.state)||row.reservation_id!==reservationId||
       row.engine_id!==engineId||row.channel_id!==channelId)return blocked('lease_reservation_mismatch');
    const {rows:[clock]}=await c.query('SELECT clock_timestamp() AS now');
    const now=new Date(clock.now).getTime();
    if(fence?.authoritative!==true||fence?.scope!=='all_paths'||fence.sourceId!==sourceId||
       fence.reservationId!==reservationId||fence.engineId!==engineId||
       !Number.isSafeInteger(fence.observedAt)||fence.observedAt<now-10000||fence.observedAt>now+2000||
       !Number.isSafeInteger(fence.expiresAt)||fence.expiresAt<=now+15000)return blocked('lease_ingress_fence_unconfirmed');
    // Read the actual ingress gate under the same source transaction.
    // External evidence alone cannot permit renewal after a gate changes.
    const {rows:[gate]}=await c.query('SELECT mode,reservation_id,engine_id FROM blofy_engine_ingress_gate WHERE source_id=$1',[sourceId]);
    if(gate?.mode!=='engine'||gate.reservation_id!==reservationId||gate.engine_id!==engineId)return blocked('lease_ingress_gate_closed');
    const {rows:[holds]}=await c.query('SELECT count(*)::int n FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
    if(holds.n!==0)return blocked('lease_legacy_holds_open');
    const sequence=Number(row.worker_lease_sequence)+1;
    if(!Number.isSafeInteger(sequence)||sequence<1)return blocked('lease_sequence_invalid');
    const lease=signLiveLease({version:1,sourceId,reservationId,channelId,engineId,sequence,
      issuedAt:now,expiresAt:Math.min(now+60000,fence.expiresAt)},signingKey,now);
    await c.query('UPDATE blofy_linode_feed_ledger SET worker_lease_sequence=$2 WHERE source_id=$1',[sourceId,sequence]);
    return {ok:true,...lease};
   });
  },
  // Trusted internal lookup only. This cannot authorize playback or open a
  // source socket. attachViewer must recheck this identity under the same
  // source lock before any signed grant is returned.
  async findReady({sourceId,channelId,engineId='linode'}={}){
   if(!enabled(sourceId)||!engineAllowed(engineId)||env.BLOFY_LINODE_VIEWER_LEDGER!=='1'||
      typeof channelId!=='string'||!channel.test(channelId))return blocked('disabled_or_invalid');
   return tx(sourceId,async(c,row)=>{
    if(!row||row.state!=='ready'||row.engine_id!==engineId||row.channel_id!==channelId||
       !/^[a-f0-9]{32}$/.test(row.generation||'')||!uuid.test(row.reservation_id||''))
      return blocked('feed_not_ready');
    return {ok:true,engineId,sourceId,channelId,reservationId:row.reservation_id,generation:row.generation,
      requestId:row.request_id};
   });
  },
  async reserve({sourceId,channelId,requestId,engineId='linode'}={}){
   if(!enabled(sourceId)||!engineAllowed(engineId)||typeof channelId!=='string'||!channel.test(channelId)||typeof requestId!=='string'||!uuid.test(requestId)||requestId!==requestId.toLowerCase())return blocked('disabled_or_invalid');
   return tx(sourceId,async(c,row)=>{
    if(row&&row.state!=='released'){
     if(row.request_id===requestId&&row.channel_id===channelId&&row.state!=='unknown'&&row.engine_id===engineId)
      return {ok:true,action:'existing',reservationId:row.reservation_id,state:row.state};
     return blocked('feed_occupied_or_uncertain');
    }
    // A replay of the last released request must not reopen its feed.
    if(row?.request_id===requestId)return blocked('request_closed');
    const claimed=await c.query('INSERT INTO blofy_linode_feed_requests(request_id,source_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING request_id',[requestId,sourceId]);
    if(claimed.rowCount!==1)return blocked('request_closed');
    const reservationId=randomUUID();
    await c.query(`INSERT INTO blofy_linode_feed_ledger
     (source_id,channel_id,request_id,reservation_id,state,engine_id)
     VALUES($1,$2,$3,$4,'pending',$5)
     ON CONFLICT(source_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,
     request_id=EXCLUDED.request_id,reservation_id=EXCLUDED.reservation_id,
     state='pending',generation=NULL,engine_id=EXCLUDED.engine_id,worker_lease_sequence=0,updated_at=now()`,[sourceId,channelId,requestId,reservationId,engineId]);
    return {ok:true,action:'start_once',reservationId,state:'pending'};
   });
  },
  // Only authenticated server-owned input, not public request bodies.
  // Same-source lock serializes viewer quotas and feed transitions.
  async attachViewer({sourceId,reservationId,channelId,generation,sessionId,accountId,
    accountQuota,authorizedUntil,engineId='linode'}={}){
   const valid=x=>typeof x==='string'&&uuid.test(x)&&x===x.toLowerCase();
   if(!enabled(sourceId)||!engineAllowed(engineId)||env.BLOFY_LINODE_VIEWER_LEDGER!=='1'||
      ![reservationId,sessionId,accountId].every(valid)||typeof channelId!=='string'||
      !channel.test(channelId)||typeof generation!=='string'||!/^[0-9a-f]{32}$/.test(generation)||
      !Number.isSafeInteger(accountQuota)||accountQuota<1||accountQuota>150||
      typeof authorizedUntil!=='string'||!Number.isFinite(Date.parse(authorizedUntil)))
     return blocked('viewer_invalid');
   return tx(sourceId,async(c,row)=>{
    if(!row||row.engine_id!==engineId||row.state!=='ready'||row.reservation_id!==reservationId||
       row.channel_id!==channelId||row.generation!==generation)return blocked('feed_not_ready');
    const {rows:[clock]}=await c.query('SELECT clock_timestamp() AS now');
    const now=new Date(clock.now).getTime();
    const until=Math.min(Date.parse(authorizedUntil),now+60000);
    if(until<=now+5000)return blocked('viewer_expired');
    const {rows:[old]}=await c.query('SELECT * FROM blofy_linode_viewer_sessions WHERE session_id=$1',[sessionId]);
    if(old&&(old.closed||new Date(old.expires_at).getTime()<=now||
       old.account_id!==accountId||old.source_id!==sourceId||old.reservation_id!==reservationId||
       old.channel_id!==channelId||old.generation!==generation))return blocked('viewer_session_closed_or_mismatch');
    // Closed sessions can still have an outstanding signed URL. Count them
    // until its bounded lease expires; close only denies further renewal.
    const {rows:[counts]}=await c.query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE account_id=$2)::int AS account
      FROM blofy_linode_viewer_sessions
      WHERE reservation_id=$1 AND expires_at>$3 AND session_id<>$4`,
      [reservationId,accountId,new Date(now),sessionId]);
    if(counts.total>=150||counts.account>=accountQuota)return blocked('viewer_quota');
    const expiresAt=new Date(until).toISOString();
    const result=await c.query(`INSERT INTO blofy_linode_viewer_sessions
      (session_id,source_id,reservation_id,account_id,channel_id,generation,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(session_id) DO UPDATE SET expires_at=GREATEST(blofy_linode_viewer_sessions.expires_at,EXCLUDED.expires_at)
      WHERE NOT blofy_linode_viewer_sessions.closed
        AND blofy_linode_viewer_sessions.account_id=EXCLUDED.account_id
        AND blofy_linode_viewer_sessions.source_id=EXCLUDED.source_id
        AND blofy_linode_viewer_sessions.reservation_id=EXCLUDED.reservation_id
        AND blofy_linode_viewer_sessions.channel_id=EXCLUDED.channel_id
        AND blofy_linode_viewer_sessions.generation=EXCLUDED.generation
        AND blofy_linode_viewer_sessions.expires_at>$8
      RETURNING session_id`,[sessionId,sourceId,reservationId,accountId,channelId,generation,expiresAt,new Date(now)]);
    if(result.rowCount!==1)return blocked('viewer_session_conflict');
    return {ok:true,sessionId,reservationId,expiresAt};
   });
  },
  async closeViewer({sourceId,reservationId,sessionId,accountId,engineId='linode'}={}){
   if(!enabled(sourceId)||env.BLOFY_LINODE_VIEWER_LEDGER!=='1'||
     ![reservationId,sessionId,accountId].every(x=>typeof x==='string'&&uuid.test(x)))return blocked('viewer_invalid');
   return tx(sourceId,async(c,row)=>{
    if(!row||row.engine_id!==engineId||row.reservation_id!==reservationId)return blocked('reservation_mismatch');
    const r=await c.query(`UPDATE blofy_linode_viewer_sessions SET closed=true
      WHERE session_id=$1 AND source_id=$2 AND reservation_id=$3 AND account_id=$4`,
      [sessionId,sourceId,reservationId,accountId]);
    return r.rowCount===1?{ok:true}:blocked('viewer_session_mismatch');
   });
  },
  async transition({sourceId,reservationId,next,generation,releaseConfirmed,engineId='linode'}={}){
   if(!enabled(sourceId)||!engineAllowed(engineId)||!uuid.test(reservationId||''))return blocked('disabled_or_invalid');
   return tx(sourceId,async(c,row)=>{
    if(!row||row.engine_id!==engineId||row.reservation_id!==reservationId||row.state==='released')return blocked('reservation_mismatch');
    if(next==='ready'&&row.state==='pending'&&/^[0-9a-f]{32}$/.test(generation||'')){
     await c.query("UPDATE blofy_linode_feed_ledger SET state='ready',generation=$2,updated_at=now() WHERE source_id=$1",[sourceId,generation]);
    }else if(next==='unknown'&&['pending','ready'].includes(row.state)){
     await c.query("UPDATE blofy_linode_feed_ledger SET state='unknown',updated_at=now() WHERE source_id=$1",[sourceId]);
    }else if(next==='released'&&releaseConfirmed===true){
     // Only trusted capacity owner may assert release, never client JSON.
     await c.query("UPDATE blofy_linode_feed_ledger SET state='released',generation=NULL,updated_at=now() WHERE source_id=$1",[sourceId]);
    }else return blocked('transition_denied');
    return {ok:true,state:next};
   });
  }
 };
}
