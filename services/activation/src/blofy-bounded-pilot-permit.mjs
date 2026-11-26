import {sign} from 'node:crypto';
import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
const ENGINES=new Set(['linode','hostbrr']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const message=p=>Buffer.from(JSON.stringify(['BLOFY_BOUNDED_PILOT_V1',p.version,p.engineId,p.operation,p.permitId,p.issuedAt,p.expiresAt]));
// A single operator-authorized, time-bounded pilot. No arbitrary command,
// source URL, channel, environment or customer cutover may be supplied.
// Issuance requires a separately verified exclusive maintenance window.
export function createBoundedPilotPermit(db,{controllerKey,workerKeys,env=process.env,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS pilot_permits(permit_id TEXT PRIMARY KEY,engine TEXT NOT NULL,issued INTEGER NOT NULL,expires INTEGER NOT NULL)');
 return function poll(e){
  const now=clock(),engine=e?.status?.engineId;
  if(!ENGINES.has(engine)||!Object.hasOwn(workerKeys,engine)||!verifyWorkerStatus(e,{publicKey:workerKeys[engine],engineId:engine,challenge:e.status.challenge,now}))return {code:403,body:{ok:false}};
  const id=env.BLOFY_BOUNDED_PILOT_PERMIT_ID,expires=Number(env.BLOFY_BOUNDED_PILOT_EXPIRES_MS);
  if(env.BLOFY_BOUNDED_PILOT_EXCLUSIVE_CONFIRMED!=='1'||env.BLOFY_BOUNDED_PILOT_ENGINE!==engine||!UUID.test(id??'')||!Number.isSafeInteger(expires)||expires<=now||expires>now+600000)return {code:200,body:{ok:true,permit:null}};
  // Persist immutable expiry/target before dispatch. No change or reuse of ID.
  db.prepare('INSERT OR IGNORE INTO pilot_permits VALUES(?,?,?,?)').run(id,engine,now,expires);
  const row=db.prepare('SELECT * FROM pilot_permits WHERE permit_id=?').get(id);
  if(row.engine!==engine||row.expires!==expires||row.expires<=now)return {code:409,body:{ok:false}};
  const permit={version:1,engineId:engine,operation:'run_bounded_pilot',permitId:id,issuedAt:row.issued,expiresAt:row.expires};
  return {code:200,body:{ok:true,permit,signature:sign(null,message(permit),controllerKey).toString('base64url')}};
 };
}
