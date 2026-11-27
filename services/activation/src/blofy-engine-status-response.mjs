import {verify} from 'node:crypto';
const fields=['version','engineId','challenge','observedAt','deliveryActive','heartbeatActive'];
const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===ks.slice().sort().join(',');
const hex=/^[a-f0-9]{32}$/;
export function verifyWorkerStatus(envelope,{publicKey,engineId,challenge,now=Date.now()}={}){
 try{
  if(!exact(envelope,['status','signature']))return false;
  const s=envelope.status;
  if(!exact(s,fields)||s.version!==1||!['linode','hostbrr'].includes(engineId)||s.engineId!==engineId||
    typeof challenge!=='string'||!hex.test(challenge)||s.challenge!==challenge||
    !Number.isSafeInteger(s.observedAt)||s.observedAt<now-30000||s.observedAt>now+2000||
    typeof s.deliveryActive!=='boolean'||typeof s.heartbeatActive!=='boolean'||
    publicKey?.type!=='public'||publicKey.asymmetricKeyType!=='ed25519'||
    typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))return false;
  const sig=Buffer.from(envelope.signature,'base64url');
  const payload=Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...fields.map(k=>s[k])]));
  return sig.length===64&&sig.toString('base64url')===envelope.signature&&verify(null,payload,publicKey,sig);
 }catch{return false}
}
// Caller must supply its own pinned public key, outstanding challenge and
// atomically consume the challenge after verification. Health is not admission,
// source entitlement, source release, or proof of playable media.
