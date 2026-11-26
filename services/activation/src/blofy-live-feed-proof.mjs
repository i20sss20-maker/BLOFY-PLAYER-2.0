import {sign,verify} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{32}$/;
const fields=['version','engineId','sourceId','channelId','reservationId','generation','challenge','observedAt','status','lastSegment','localSourceConnections'];
const encode=p=>Buffer.from(JSON.stringify(['BLOFY_LIVE_FEED_PROOF_V1',...fields.map(k=>p[k])]));
const valid=(p,now)=>p&&Object.keys(p).sort().join(',')===fields.slice().sort().join(',')&&p.version===1&&['hostbrr','linode'].includes(p.engineId)&&uuid.test(p.sourceId)&&uuid.test(p.reservationId)&&/^[1-9][0-9]{0,14}$/.test(p.channelId)&&hex.test(p.generation)&&hex.test(p.challenge)&&Number.isSafeInteger(p.observedAt)&&p.observedAt>=now-10000&&p.observedAt<=now+2000&&(
 (p.status==='private_hls_ready'&&Number.isSafeInteger(p.lastSegment)&&p.lastSegment>=0&&p.localSourceConnections===1)||
 (p.status==='stopped_and_fenced'&&p.lastSegment===null&&p.localSourceConnections===0));
export function signFeedProof(p,key,now=Date.now()){
 if(!valid(p,now)||key?.type!=='private'||key.asymmetricKeyType!=='ed25519')throw Error('invalid_feed_proof');
 return {proof:p,signature:sign(null,encode(p),key).toString('base64url')};
}
export function verifyFeedProof(e,{key,identity,challenge,now=Date.now()}={}){
 try{
  const p=e.proof;
  if(Object.keys(e).sort().join(',')!=='proof,signature'||!valid(p,now)||!identity||p.challenge!==challenge||
     !['engineId','sourceId','channelId','reservationId','generation'].every(k=>p[k]===identity[k])||
     key?.type!=='public'||key.asymmetricKeyType!=='ed25519'||!/^[A-Za-z0-9_-]{86}$/.test(e.signature))return false;
  const sig=Buffer.from(e.signature,'base64url');
  return sig.length===64&&sig.toString('base64url')===e.signature&&verify(null,encode(p),key,sig);
 }catch{return false}
}
// This proof is local worker evidence only. A ready report does not authorize
// a customer, and a stop report does not certify the provider slot is free.
// Consume a server-issued challenge once in a durable store before accepting it.
