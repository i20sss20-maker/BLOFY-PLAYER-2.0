import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
import {verifyLiveLease} from './blofy-live-worker-lease.mjs';
// Executable bridge between the already-committed source ledger and the
// authenticated engine poll. No new reservation, capacity or entitlement is
// inferred from this transport. All authorities are injected by the caller.
export function createLiveLeasePoll({db,ledger,readFence,controllerKey,workerKeys,sourceId,enabled=false,clock=Date.now}={}){
 const deny=(code=409)=>({code,body:{ok:false}});
 const standby=()=>({code:200,body:{ok:true,lease:null}});
 db.exec('CREATE TABLE IF NOT EXISTS live_lease_poll_replay(engine TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(engine,challenge));');
 const prune=db.prepare('DELETE FROM live_lease_poll_replay WHERE expires<=?');
 const seen=db.prepare('INSERT OR IGNORE INTO live_lease_poll_replay VALUES(?,?,?)');
 const count=db.prepare('SELECT count(*) n FROM live_lease_poll_replay WHERE engine=?');
 return async function poll(e){
  const now=clock(),id=e?.status?.engineId;
  if(!id||!Object.hasOwn(workerKeys,id)||!verifyWorkerStatus(e,{publicKey:workerKeys[id],engineId:id,challenge:e.status.challenge,now}))return deny(403);
  if(!enabled)return standby();
  db.exec('BEGIN IMMEDIATE');
  try{
   prune.run(now);
   const fresh=count.get(id).n<32&&seen.run(id,e.status.challenge,now+33000).changes===1;
   db.exec('COMMIT');if(!fresh)return deny(429);
  }catch(err){db.exec('ROLLBACK');throw err}
  if(e.status.deliveryActive!==true||e.status.heartbeatActive!==true)return standby();
  if(typeof ledger?.readRoutingState!=='function'||typeof ledger?.issueWorkerLease!=='function'||typeof readFence!=='function')return standby();
  try{
   const r=await ledger.readRoutingState({sourceId});
   if(!r||r.sourceId!==sourceId||r.engineId!==id||!['pending','ready'].includes(r.state))return standby();
   const identity={sourceId,engineId:id,channelId:r.channelId,reservationId:r.reservationId};
   const fence=await readFence(identity);
   // issueWorkerLease checks scope/freshness under the same PostgreSQL
   // source lock as reserve/transition; never sign from this poll alone.
   const issued=await ledger.issueWorkerLease({...identity,fence,signingKey:controllerKey});
   if(!issued?.ok)return standby();
   const envelope={lease:issued.lease,signature:issued.signature};
   if(!verifyLiveLease(envelope,{key:workerPublicControllerKey(),identity,now:clock()}))return deny();
   return {code:200,body:{ok:true,...envelope}};
  }catch{return deny(503)}
 };
 function workerPublicControllerKey(){return controllerKeyPublic(controllerKey)}
}
import {createPublicKey as controllerKeyPublic} from 'node:crypto';
