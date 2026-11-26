import {randomUUID} from 'node:crypto';
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
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_linode_feed_requests (
 request_id uuid PRIMARY KEY, source_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
 )`);
}
export function createLinodeFeedLedger(pool,env=process.env){
 const enabled=sourceId=>env.BLOFY_LINODE_FEED_LEDGER==='1'&&
   typeof sourceId==='string'&&uuid.test(sourceId)&&sourceId===sourceId.toLowerCase()&&sourceId===env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID;
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
  async reserve({sourceId,channelId,requestId}={}){
   if(!enabled(sourceId)||!channel.test(channelId||'')||!uuid.test(requestId||'')||requestId!==requestId.toLowerCase())return blocked('disabled_or_invalid');
   return tx(sourceId,async(c,row)=>{
    if(row&&row.state!=='released'){
     if(row.request_id===requestId&&row.channel_id===channelId&&row.state!=='unknown')
      return {ok:true,action:'existing',reservationId:row.reservation_id,state:row.state};
     return blocked('feed_occupied_or_uncertain');
    }
    // A replay of the last released request must not reopen its feed.
    if(row?.request_id===requestId)return blocked('request_closed');
    const claimed=await c.query('INSERT INTO blofy_linode_feed_requests(request_id,source_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING request_id',[requestId,sourceId]);
    if(claimed.rowCount!==1)return blocked('request_closed');
    const reservationId=randomUUID();
    await c.query(`INSERT INTO blofy_linode_feed_ledger
     (source_id,channel_id,request_id,reservation_id,state)
     VALUES($1,$2,$3,$4,'pending')
     ON CONFLICT(source_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,
     request_id=EXCLUDED.request_id,reservation_id=EXCLUDED.reservation_id,
     state='pending',generation=NULL,updated_at=now()`,[sourceId,channelId,requestId,reservationId]);
    return {ok:true,action:'start_once',reservationId,state:'pending'};
   });
  },
  async transition({sourceId,reservationId,next,generation,releaseConfirmed}={}){
   if(!enabled(sourceId)||!uuid.test(reservationId||''))return blocked('disabled_or_invalid');
   return tx(sourceId,async(c,row)=>{
    if(!row||row.reservation_id!==reservationId||row.state==='released')return blocked('reservation_mismatch');
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
