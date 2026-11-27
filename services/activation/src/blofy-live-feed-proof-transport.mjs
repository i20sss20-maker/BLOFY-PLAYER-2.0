import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
import {createLiveFeedProofInbox} from './blofy-live-feed-proof-inbox.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Read-only worker proof transport. Reservation must come from the committed
// ledger, not a worker claim. Never turns health into source release proof.
export function createFeedProofTransport({db,workerKeys,readReservation,enabled=false,clock=Date.now}={}){
 const inbox=createLiveFeedProofInbox(db,{workerKeys,clock});
 db.exec('CREATE TABLE IF NOT EXISTS feed_proof_poll_replay(engine TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(engine,challenge));');
 const reply=(code,body)=>({code,body});
 const no=()=>reply(200,{ok:true,challenge:null});
 const identity=async(engineId)=>{
  if(!enabled||typeof readReservation!=='function')return null;
  const r=await readReservation(engineId);
  if(r?.engineId!==engineId||!['pending','ready'].includes(r.state)||!uuid.test(r.sourceId??'')||
     !uuid.test(r.reservationId??'')||!/^[1-9][0-9]{0,14}$/.test(r.channelId??''))return null;
  const generation=r.reservationId.replaceAll('-','');
  if(r.state==='ready'&&r.generation!==generation)return null;
  return {engineId,sourceId:r.sourceId,channelId:r.channelId,reservationId:r.reservationId,generation};
 };
 return {
  async poll(e){
   const now=clock(),s=e?.status,id=s?.engineId;
   if(!id||!Object.hasOwn(workerKeys,id)||!verifyWorkerStatus(e,{publicKey:workerKeys[id],engineId:id,challenge:s.challenge,now}))return reply(403,{ok:false});
   if(!enabled)return no();
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('DELETE FROM feed_proof_poll_replay WHERE expires<=?').run(now);
    const n=db.prepare('SELECT count(*) n FROM feed_proof_poll_replay WHERE engine=?').get(id).n;
    const fresh=n<32&&db.prepare('INSERT OR IGNORE INTO feed_proof_poll_replay VALUES(?,?,?)').run(id,s.challenge,now+33000).changes===1;
    db.exec('COMMIT');
    if(!fresh)return reply(429,{ok:false});
   }catch(e){db.exec('ROLLBACK');throw e}
   if(!s.deliveryActive||!s.heartbeatActive)return no();
   const r=await identity(id);
   if(!r)return no();
   const issued=inbox.issue(r);
   return issued?reply(200,{ok:true,identity:r,...issued}):no();
  },
  async complete(e){
   const p=e?.proof;
   if(!enabled||!p||!Object.hasOwn(workerKeys,p.engineId)||p.status!=='private_hls_ready')return reply(403,{ok:false});
   const r=await identity(p.engineId);
   if(!r||Object.keys(r).some(k=>p[k]!==r[k]))return reply(409,{ok:false});
   return inbox.accept(e)?reply(200,{ok:true}):reply(409,{ok:false});
  },
  read:identity=>inbox.read(identity)
 };
}
