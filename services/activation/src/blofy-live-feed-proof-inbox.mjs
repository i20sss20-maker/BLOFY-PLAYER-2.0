import {randomBytes} from 'node:crypto';
import {verifyFeedProof} from './blofy-live-feed-proof.mjs';
const keys=['engineId','sourceId','channelId','reservationId','generation'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const valid=x=>x&&keys.every(k=>typeof x[k]==='string')&&['hostbrr','linode'].includes(x.engineId)&&uuid.test(x.sourceId)&&uuid.test(x.reservationId)&&/^[1-9][0-9]{0,14}$/.test(x.channelId)&&/^[a-f0-9]{32}$/.test(x.generation);
const canonical=x=>JSON.stringify(keys.map(k=>x[k]));
// Internal only. Challenge identity must come from the committed reservation,
// not a public request. This stores local proof, not provider release.
export function createLiveFeedProofInbox(db,{workerKeys,clock=Date.now}={}){
 db.exec('CREATE TABLE IF NOT EXISTS feed_proof_challenges(challenge TEXT PRIMARY KEY, identity TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS feed_proofs(reservation TEXT PRIMARY KEY, identity TEXT NOT NULL, observed INTEGER NOT NULL, proof TEXT NOT NULL);');
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}};
 return {
  issue(identity){
   if(!valid(identity)||!Object.hasOwn(workerKeys,identity.engineId))return null;
   return tx(()=>{
    const now=clock(),challenge=randomBytes(16).toString('hex');
    db.prepare('DELETE FROM feed_proof_challenges WHERE expires<=?').run(now);
    const encoded=canonical(identity);
    if(db.prepare('SELECT count(*) n FROM feed_proof_challenges WHERE identity=?').get(encoded).n>=4)return null;
    db.prepare('INSERT INTO feed_proof_challenges VALUES(?,?,?)').run(challenge,encoded,now+10000);
    return {challenge,expiresAt:now+10000};
   });
  },
  accept(e){
   const p=e?.proof;if(!valid(p)||!Object.hasOwn(workerKeys,p.engineId))return false;
   return tx(()=>{
    const now=clock(),r=db.prepare('SELECT * FROM feed_proof_challenges WHERE challenge=?').get(p.challenge??'');
    if(!r||r.expires<=now||r.identity!==canonical(p)||!verifyFeedProof(e,{key:workerKeys[p.engineId],identity:p,challenge:r.challenge,now}))return false;
    const old=db.prepare('SELECT identity,observed,proof FROM feed_proofs WHERE reservation=?').get(p.reservationId);
    if(old&&(old.identity!==r.identity||p.observedAt<=old.observed||JSON.parse(old.proof).status==='stopped_and_fenced'))return false;
    if(db.prepare('DELETE FROM feed_proof_challenges WHERE challenge=?').run(r.challenge).changes!==1)return false;
    db.prepare('INSERT INTO feed_proofs VALUES(?,?,?,?) ON CONFLICT(reservation) DO UPDATE SET observed=excluded.observed,proof=excluded.proof').run(p.reservationId,r.identity,p.observedAt,JSON.stringify(p));
    return true;
   });
  },
  read(identity){
   if(!valid(identity))return null;
   const r=db.prepare('SELECT * FROM feed_proofs WHERE reservation=?').get(identity.reservationId),now=clock();
   if(!r||r.identity!==canonical(identity)||r.observed<now-10000||r.observed>now+2000)return null;
   return JSON.parse(r.proof);
  }
 };
}
