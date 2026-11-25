// Durable reservations for a separately authorized media pool. This module
// does not open feeds or control existing legacy connections. The caller must
// verify rights and enforce the physical allocation, then supply trusted inputs.
// A reservation remains counted after expiry until the capacity owner confirms
// that no feed was opened or the feed is closed.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=x=>typeof x==='string'&&UUID.test(x)?x.toLowerCase():null;
const channel=x=>typeof x==='string'&&/^[1-9][0-9]{0,14}$/.test(x)?x:null;
const reject=reason=>({state:'denied',reason,authoritative:false});
export const reservationSchema=`
CREATE TABLE IF NOT EXISTS blofy_linode_reservations (
 request_id uuid PRIMARY KEY, reservation_id uuid NOT NULL UNIQUE,
 source_id uuid NOT NULL, account_id uuid NOT NULL, channel_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('reserved','released')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz
);
CREATE INDEX IF NOT EXISTS blofy_linode_reservations_active_source
 ON blofy_linode_reservations(source_id) WHERE state='reserved';
`;
// Run migrations explicitly; no DDL on playback requests.
export async function installReservationSchema(pool){await pool.query(reservationSchema)}
async function transaction(pool,work){
 const c=await pool.connect();
 try{
   await c.query('BEGIN');
   await c.query("SET LOCAL lock_timeout='2s'");
   await c.query("SET LOCAL statement_timeout='5s'");
   const result=await work(c);
   await c.query('COMMIT'); return result;
 }catch{
   try{await c.query('ROLLBACK')}catch{}
   return {state:'unknown',reason:'transaction_outcome_unknown'};
 }finally{c.release()}
}
const lock=async(c,source)=>c.query("SELECT pg_advisory_xact_lock(hashtextextended('blofy-linode-reservation:' || $1::text,0))",[source]);
const read=async(c,request)=>(await c.query('SELECT * FROM blofy_linode_reservations WHERE request_id=$1',[request])).rows[0];
function view(row){
 return {state:row.state,requestId:row.request_id,reservationId:row.reservation_id,
   sourceId:row.source_id,accountId:row.account_id,channelId:row.channel_id,
   expiresAt:new Date(row.expires_at).toISOString(),authoritative:true,
   committed:row.state==='reserved',noNewFeed:row.state==='released'};
}
export async function reserveLinodeFeed(pool,request,grant,now=Date.now()){
 const requestId=id(request?.requestId),sourceId=id(request?.sourceId),
 accountId=id(request?.accountId),channelId=channel(request?.channelId);
 const expiry=Date.parse(request?.expiresAt),grantExpiry=Date.parse(grant?.expiresAt);
 const capacity=grant?.quota;
 if(!requestId||!sourceId||!accountId||!channelId||!Number.isFinite(now)||
    grant?.verified!==true||grant?.scope!=='dedicated_licensed_pool'||
    id(grant.sourceId)!==sourceId||!Number.isSafeInteger(capacity)||capacity<1||capacity>64||
    !Number.isFinite(expiry)||expiry<=now||expiry>now+60000||
    !Number.isFinite(grantExpiry)||grantExpiry<expiry)
    return reject('invalid_or_unverified_allocation');
 return transaction(pool,async c=>{
   await lock(c,sourceId);
   const existing=await read(c,requestId);
   if(existing){
     if(existing.source_id!==sourceId||existing.account_id!==accountId||existing.channel_id!==channelId)
       return reject('request_conflict');
     return view(existing);
   }
   // Conservative: one slot per reservation, no speculative sharing.
   // Expired leases are still counted, because expiry cannot close a socket.
   const count=(await c.query("SELECT count(*)::int AS n FROM blofy_linode_reservations WHERE source_id=$1 AND state='reserved'",[sourceId])).rows[0].n;
   if(count>=capacity)return reject('capacity_exhausted');
   const row=(await c.query(`INSERT INTO blofy_linode_reservations
     (request_id,reservation_id,source_id,account_id,channel_id,state,expires_at)
     VALUES($1,$2,$3,$4,$5,'reserved',$6) RETURNING *`,
     [requestId,randomUUID(),sourceId,accountId,channelId,new Date(expiry)])).rows[0];
   return view(row);
 });
}
// confirmation MUST be from the actual capacity owner, not from a client,
// lease timeout, or health heartbeat. This ledger alone cannot verify it.
export async function releaseLinodeFeed(pool,confirmation){
 const requestId=id(confirmation?.requestId),sourceId=id(confirmation?.sourceId),
 reservationId=id(confirmation?.reservationId);
 if(!requestId||!sourceId||!reservationId||confirmation?.authoritative!==true||
    confirmation?.noFeedRemaining!==true)return {state:'unknown',reason:'closure_not_confirmed'};
 return transaction(pool,async c=>{
   await lock(c,sourceId);
   const row=await read(c,requestId);
   if(!row||row.source_id!==sourceId||row.reservation_id!==reservationId)
     return {state:'unknown',reason:'reservation_mismatch'};
   if(row.state==='released')return view(row);
   const updated=(await c.query(`UPDATE blofy_linode_reservations SET state='released',released_at=now()
     WHERE request_id=$1 AND reservation_id=$2 RETURNING *`,[requestId,reservationId])).rows[0];
   return view(updated);
 });
}
