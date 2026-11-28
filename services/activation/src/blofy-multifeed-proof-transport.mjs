import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
import {createLiveFeedProofInbox} from './blofy-live-feed-proof-inbox.mjs';
// Shadow controller proof transport. Only committed reservations from the
// injected reader may be challenged. No lease issuance or production routing.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createMultiFeedProofTransport({db,workerKeys,readReservations,enabled=false,clock=Date.now}={}){
 const inbox=createLiveFeedProofInbox(db,{workerKeys,clock});
 db.exec('CREATE TABLE IF NOT EXISTS multi_feed_poll_replay(engine TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(engine,challenge));');
 const reply=(code,body)=>({code,body});
 const no=()=>reply(200,{ok:true,challenges:[]});
 async function identities(id){
  const rows=await readReservations(id);
  if(!Array.isArray(rows)||rows.length>64)return null;
  const reservations=new Set(),channels=new Set(),out=[];
  for(const r of rows){
   if(r?.engineId!==id||!uuid.test(r.sourceId??'')||!uuid.test(r.reservationId??'')||
      !/^[1-9][0-9]{0,14}$/.test(r.channelId??'')||reservations.has(r.reservationId)||
      channels.has(r.sourceId+':'+r.channelId))return null;
   reservations.add(r.reservationId);channels.add(r.sourceId+':'+r.channelId);
   if(!['pending','reserved','starting','ready'].includes(r.state))continue;
   const generation=r.reservationId.replaceAll('-','');
   if(r.state==='ready'&&r.generation!==generation)return null;
   out.push({engineId:id,sourceId:r.sourceId,channelId:r.channelId,reservationId:r.reservationId,generation});
  }
  return out;
 }
 return {
  async poll(e){
   const s=e?.status,id=s?.engineId,now=clock();
   if(!id||!Object.hasOwn(workerKeys,id)||!verifyWorkerStatus(e,{publicKey:workerKeys[id],engineId:id,challenge:s.challenge,now}))return reply(403,{ok:false});
   if(!enabled||typeof readReservations!=='function')return no();
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('DELETE FROM multi_feed_poll_replay WHERE expires<=?').run(now);
    const n=db.prepare('SELECT count(*) n FROM multi_feed_poll_replay WHERE engine=?').get(id).n;
    const fresh=n<32&&db.prepare('INSERT OR IGNORE INTO multi_feed_poll_replay VALUES(?,?,?)').run(id,s.challenge,now+33000).changes===1;
    db.exec('COMMIT');if(!fresh)return reply(429,{ok:false});
   }catch(err){db.exec('ROLLBACK');throw err}
   if(!s.deliveryActive||!s.heartbeatActive)return no();
   const rows=await identities(id);
   if(!rows)return reply(409,{ok:false});
   const challenges=[];
   // bounded batch; workers must not infer permission to start from a poll
   for(const identity of rows){
    const issued=inbox.issue(identity);
    if(issued)challenges.push({identity,...issued});
   }
   return reply(200,{ok:true,challenges});
  },
  async complete(e){
   const p=e?.proof;
   if(!enabled||typeof readReservations!=='function'||!p||!Object.hasOwn(workerKeys,p.engineId)||p.status!=='private_hls_ready')return reply(403,{ok:false});
   const rows=await identities(p.engineId);
   const r=rows?.find(x=>x.reservationId===p.reservationId);
   if(!r||Object.keys(r).some(k=>p[k]!==r[k]))return reply(409,{ok:false});
   return inbox.accept(e)?reply(200,{ok:true}):reply(409,{ok:false});
  },
  read:identity=>inbox.read(identity)
 };
}
