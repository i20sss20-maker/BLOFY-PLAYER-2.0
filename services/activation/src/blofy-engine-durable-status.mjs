import {randomBytes} from 'node:crypto';
import {signStatusCommand} from './blofy-engine-status-command.mjs';
import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';

// Single-instance durable status-only command transport. No start/stop or
// source access. The caller authenticates each poll and completion here.
export function createDurableStatusTransport(db,{controllerKey,workerKeys,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS pending_status(
 engine TEXT PRIMARY KEY,challenge TEXT NOT NULL,issued INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS poll_replay(engine TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(engine,challenge));
 CREATE TABLE IF NOT EXISTS worker_status(engine TEXT PRIMARY KEY,observed INTEGER NOT NULL,delivery INTEGER NOT NULL,heartbeat INTEGER NOT NULL);`);
 const one=db.prepare('SELECT * FROM pending_status WHERE engine=?');
 const insert=db.prepare('INSERT INTO pending_status VALUES(?,?,?,?) ON CONFLICT(engine) DO UPDATE SET challenge=excluded.challenge,issued=excluded.issued,expires=excluded.expires');
 const remove=db.prepare('DELETE FROM pending_status WHERE engine=? AND challenge=?');
 const prune=db.prepare('DELETE FROM poll_replay WHERE expires<=?');
 const seen=db.prepare('INSERT OR IGNORE INTO poll_replay VALUES(?,?,?)');
 const count=db.prepare('SELECT COUNT(*) AS n FROM poll_replay WHERE engine=?');
 const save=db.prepare('INSERT INTO worker_status VALUES(?,?,?,?) ON CONFLICT(engine) DO UPDATE SET observed=excluded.observed,delivery=excluded.delivery,heartbeat=excluded.heartbeat WHERE excluded.observed>worker_status.observed');
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const authenticated=(e,now)=>{
  const engine=e?.status?.engineId,challenge=e?.status?.challenge;
  return typeof engine==='string'&&Object.hasOwn(workerKeys,engine)&&verifyWorkerStatus(e,{publicKey:workerKeys[engine],engineId:engine,challenge,now})?engine:null;
 };
 return {
  poll(e){
   const now=clock(),engine=authenticated(e,now);
   if(!engine)return {code:403,body:{ok:false}};
   return tx(()=>{
    prune.run(now);
    if(count.get(engine).n>=32||seen.run(engine,e.status.challenge,now+33000).changes!==1)return {code:429,body:{ok:false}};
    let p=one.get(engine);
    if(!p||p.expires<=now){p={challenge:randomBytes(16).toString('hex'),issued:now,expires:now+25000};insert.run(engine,p.challenge,p.issued,p.expires);}
    return {code:200,body:signStatusCommand({version:1,engineId:engine,operation:'status',challenge:p.challenge,issuedAt:p.issued,expiresAt:p.expires},controllerKey,now)};
   });
  },
  complete(e){
   const now=clock(),engine=authenticated(e,now);
   if(!engine)return {code:403,body:{ok:false}};
   return tx(()=>{
    const p=one.get(engine),s=e.status;
    if(!p||p.expires<=now||s.challenge!==p.challenge||s.observedAt<p.issued-2000)return {code:409,body:{ok:false}};
    if(remove.run(engine,p.challenge).changes!==1)return {code:409,body:{ok:false}};
    save.run(engine,s.observedAt,Number(s.deliveryActive),Number(s.heartbeatActive));
    return {code:200,body:{ok:true,engineId:engine,deliveryActive:s.deliveryActive,heartbeatActive:s.heartbeatActive}};
   });
  }
 };
}
