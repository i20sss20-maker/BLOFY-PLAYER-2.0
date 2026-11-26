import {sign,verify} from 'node:crypto';
const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const channel=/^[1-9][0-9]{0,14}$/;
const fields=['version','engineId','sourceId','channelId','reservationId','sequence','issuedAt','expiresAt'];
const encode=p=>Buffer.from(JSON.stringify(['BLOFY_LIVE_LEASE_V1',...fields.map(k=>p[k])]));
const valid=(p,now)=>p&&Object.keys(p).sort().join(',')===fields.slice().sort().join(',')&&p.version===1&&['hostbrr','linode'].includes(p.engineId)&&id.test(p.sourceId)&&channel.test(p.channelId)&&id.test(p.reservationId)&&Number.isSafeInteger(p.sequence)&&p.sequence>=1&&Number.isSafeInteger(p.issuedAt)&&Number.isSafeInteger(p.expiresAt)&&p.issuedAt<=now+2000&&p.issuedAt>=now-90000&&p.expiresAt>now&&p.expiresAt-p.issuedAt<=90000;
// Internal lease signing only. A caller must hold the committed source-wide
// reservation. Expiration stops a worker; it never proves source release.
export function signLiveLease(p,key,now=Date.now()){
 if(!valid(p,now)||key?.type!=='private'||key.asymmetricKeyType!=='ed25519')throw Error('invalid_live_lease');
 return {lease:p,signature:sign(null,encode(p),key).toString('base64url')};
}
export function verifyLiveLease(e,{key,identity,previousSequence=0,now=Date.now()}={}){
 try{
 if(Object.keys(e).sort().join(',')!=='lease,signature'||!valid(e.lease,now)||!identity||key?.type!=='public'||key.asymmetricKeyType!=='ed25519'||!/^[A-Za-z0-9_-]{86}$/.test(e.signature))return false;
 const p=e.lease;
 if(!['engineId','sourceId','channelId','reservationId'].every(k=>p[k]===identity[k])||p.sequence<=previousSequence)return false;
 const sig=Buffer.from(e.signature,'base64url');
 return sig.length===64&&sig.toString('base64url')===e.signature&&verify(null,encode(p),key,sig);
 }catch{return false}
}
