import {randomUUID} from 'node:crypto';
// Isolated shadow ledger: NEVER returns executable worker commands or grants.
// Not imported by production. The old ingress gate and workers still support
// one reservation per source; do not use these rows as production authority.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const channel=/^[1-9][0-9]{0,14}$/;
const engines=['hostbrr','linode'];
const deny=reason=>({ok:false,reason});
const limit=n=>Number.isInteger(n)&&n>=1&&n<=512;
export async function ensureShadowMultiFeedSchema(db){
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_shadow_multi_source(
  source_id uuid PRIMARY KEY, max_feeds int NOT NULL CHECK(max_feeds BETWEEN 1 AND 512),
  revision bigint NOT NULL DEFAULT 0)`);
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_shadow_multi_reservation(
  reservation_id uuid PRIMARY KEY, request_id uuid UNIQUE NOT NULL,
  source_id uuid NOT NULL REFERENCES blofy_shadow_multi_source(source_id),
  channel_id text NOT NULL, engine_id text NOT NULL CHECK(engine_id IN ('hostbrr','linode')),
  state text NOT NULL CHECK(state IN ('reserved','starting','ready','draining','release_unknown','released')),
  updated_at timestamptz NOT NULL DEFAULT now())`);
 await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS blofy_shadow_multi_channel_unique
  ON blofy_shadow_multi_reservation(source_id,channel_id) WHERE state<>'released'`);
 await db.query(`CREATE INDEX IF NOT EXISTS blofy_shadow_multi_engine_active
  ON blofy_shadow_multi_reservation(engine_id) WHERE state<>'released'`);
}
export function createShadowMultiFeedLedger(pool,{enabled=false,sourceId,engineLimits={hostbrr:16,linode:16}}={}){
 const allowed=enabled===true&&uuid.test(sourceId??'')&&engines.every(id=>limit(engineLimits[id]));
 const tx=async fn=>{
  if(!allowed)return deny('shadow_disabled');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   // Serialize all QA workers across sources first, then this source.
   // Keep the lock order identical for every reservation and transition.
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('blofy-shadow-multi-global',0))");
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['blofy-shadow-multi:'+sourceId]);
   const out=await fn(c);
   await c.query('COMMIT');return out;
  }catch(e){try{await c.query('ROLLBACK')}catch{}throw e;}finally{c.release()}
 };
 const read=async c=>{
  const {rows:[s]}=await c.query('SELECT max_feeds,revision FROM blofy_shadow_multi_source WHERE source_id=$1',[sourceId]);
  if(!s)return null;
  const revision=Number(s.revision);
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('shadow_revision_invalid');
  const {rows}=await c.query("SELECT reservation_id,request_id,channel_id,engine_id,state FROM blofy_shadow_multi_reservation WHERE source_id=$1 AND state<>'released' ORDER BY reservation_id",[sourceId]);
  return {sourceId,maxFeeds:s.max_feeds,revision,reservations:rows.map(r=>({
   sourceId,reservationId:r.reservation_id,requestId:r.request_id,channelId:r.channel_id,engineId:r.engine_id,state:r.state
  }))};
 };
 const bump=async c=>{await c.query('UPDATE blofy_shadow_multi_source SET revision=revision+1 WHERE source_id=$1',[sourceId])};
 return {
  async initialize(maxFeeds){if(!limit(maxFeeds))return deny('invalid_capacity');return tx(async c=>{
   await c.query('INSERT INTO blofy_shadow_multi_source(source_id,max_feeds) VALUES($1,$2) ON CONFLICT DO NOTHING',[sourceId,maxFeeds]);
   const s=await read(c);return s.maxFeeds===maxFeeds?{ok:true,shadowOnly:true}:deny('capacity_mismatch');
  })},
  async snapshot(){return tx(async c=>{const s=await read(c);return s?{ok:true,shadowOnly:true,...s}:deny('source_missing')})},
  async reserve({decision,requestId}={}){
   if(!uuid.test(requestId??'')||decision?.action!=='request_reservation'||decision.sourceId!==sourceId||
      !channel.test(decision.channelId??'')||!engines.includes(decision.engineId)||
      !Number.isSafeInteger(decision.snapshotRevision)||!limit(decision.maxFeeds))return deny('invalid_decision');
   return tx(async c=>{
    const s=await read(c);if(!s)return deny('source_missing');
    const {rows:[previous]}=await c.query('SELECT * FROM blofy_shadow_multi_reservation WHERE request_id=$1',[requestId]);
    if(previous){
     if(previous.source_id===sourceId&&previous.channel_id===decision.channelId&&previous.engine_id===decision.engineId&&previous.state!=='released')
      return {ok:true,shadowOnly:true,action:'existing',reservationId:previous.reservation_id};
     return deny('request_replayed');
    }
    if(s.revision!==decision.snapshotRevision)return deny('snapshot_changed');
    if(decision.maxFeeds!==s.maxFeeds)return deny('capacity_mismatch');
    if(s.reservations.some(r=>r.channelId===decision.channelId))return deny('channel_occupied');
    if(s.reservations.length>=s.maxFeeds)return deny('source_capacity');
    const {rows:[worker]}=await c.query("SELECT count(*)::int n FROM blofy_shadow_multi_reservation WHERE engine_id=$1 AND state<>'released'",[decision.engineId]);
    if(worker.n>=engineLimits[decision.engineId])return deny('worker_capacity');
    const reservationId=randomUUID();
    await c.query("INSERT INTO blofy_shadow_multi_reservation(reservation_id,request_id,source_id,channel_id,engine_id,state) VALUES($1,$2,$3,$4,$5,'reserved')",
     [reservationId,requestId,sourceId,decision.channelId,decision.engineId]);
    await bump(c);
    return {ok:true,shadowOnly:true,action:'recorded',reservationId};
   });
  },
  // Simulates lifecycle evidence, never invokes a worker. Unknown and
  // draining remain occupied. No clock-based auto-release is possible.
  async simulateTransition({reservationId,next,syntheticReleaseConfirmed=false}={}){
   if(!uuid.test(reservationId??''))return deny('invalid_reservation');
   return tx(async c=>{
    const s=await read(c);if(!s)return deny('source_missing');
    const r=s.reservations.find(x=>x.reservationId===reservationId);
    if(!r)return deny('reservation_missing');
    const edges={reserved:['starting','draining','release_unknown'],starting:['ready','draining','release_unknown'],
     ready:['draining','release_unknown'],draining:['released','release_unknown'],release_unknown:['released']};
    if(!edges[r.state]?.includes(next))return deny('transition_invalid');
    if(next==='released'&&syntheticReleaseConfirmed!==true)return deny('release_unconfirmed');
    await c.query('UPDATE blofy_shadow_multi_reservation SET state=$3,updated_at=now() WHERE source_id=$1 AND reservation_id=$2',[sourceId,reservationId,next]);
    await bump(c);return {ok:true,shadowOnly:true,state:next};
   });
  }
 };
}
