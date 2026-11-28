import {createPublicKey} from 'node:crypto';
import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
import {verifyLiveLease} from './blofy-live-worker-lease.mjs';
// Unwired candidate: the injected issuer MUST perform atomic source-wide
// admission and fence verification. The poll itself is never that authority.
export function createMultiLeasePoll({db,workerKeys,controllerKey,issueCommittedBatch,enabled=false,clock=Date.now}={}){
 const respond=(code,body)=>({code,body});
 const standby=()=>respond(200,{ok:true,leases:[]});
 const deny=(code)=>respond(code,{ok:false});
 db.exec('CREATE TABLE IF NOT EXISTS multi_lease_replay(engine TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(engine,challenge));');
 return async function poll(e){
  const s=e?.status,id=s?.engineId,now=clock();
  if(!id||!Object.hasOwn(workerKeys,id)||!verifyWorkerStatus(e,{publicKey:workerKeys[id],engineId:id,challenge:s.challenge,now}))return deny(403);
  if(!enabled||typeof issueCommittedBatch!=='function')return standby();
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('DELETE FROM multi_lease_replay WHERE expires<=?').run(now);
   const n=db.prepare('SELECT count(*) n FROM multi_lease_replay WHERE engine=?').get(id).n;
   const fresh=n<32&&db.prepare('INSERT OR IGNORE INTO multi_lease_replay VALUES(?,?,?)').run(id,s.challenge,now+33000).changes===1;
   db.exec('COMMIT');if(!fresh)return deny(429);
  }catch(e){db.exec('ROLLBACK');throw e}
  if(!s.deliveryActive||!s.heartbeatActive)return standby();
  try{
   // This callback is intentionally not implemented here; production
   // cannot issue any leases until the transactional authority is wired.
   const batch=await issueCommittedBatch({engineId:id});
   if(!Array.isArray(batch)||batch.length>16)return deny(409);
   const reservations=new Set(),channels=new Set(),key=createPublicKey(controllerKey);
   for(const envelope of batch){
    const l=envelope?.lease;
    if(!l||l.engineId!==id||reservations.has(l.reservationId)||channels.has(l.sourceId+':'+l.channelId)||
      !verifyLiveLease(envelope,{key,identity:l,now:clock()}))return deny(409);
    reservations.add(l.reservationId);channels.add(l.sourceId+':'+l.channelId);
   }
   return respond(200,{ok:true,leases:batch});
  }catch{return deny(503)}
 };
}
