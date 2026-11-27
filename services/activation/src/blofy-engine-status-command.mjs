import {sign,verify} from 'node:crypto';
const engines=new Set(['linode','hostbrr']);
const hex=/^[a-f0-9]{32}$/;
const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===ks.slice().sort().join(',');
const fields=['version','engineId','operation','challenge','issuedAt','expiresAt'];
const valid=(o,now)=>exact(o,fields)&&o.version===1&&engines.has(o.engineId)&&o.operation==='status'&&typeof o.challenge==='string'&&hex.test(o.challenge)&&Number.isSafeInteger(o.issuedAt)&&Number.isSafeInteger(o.expiresAt)&&o.issuedAt<=now+2000&&o.issuedAt>=now-30000&&o.expiresAt>now&&o.expiresAt>o.issuedAt&&o.expiresAt-o.issuedAt<=30000;
const bytes=o=>Buffer.from(JSON.stringify(['BLOFY_STATUS_COMMAND_V1',...fields.map(k=>o[k])]),'utf8');
export function signStatusCommand(o,key,now=Date.now()){
 if(!valid(o,now)||key?.type!=='private'||key.asymmetricKeyType!=='ed25519')throw Error('invalid_status_command');
 return {command:o,signature:sign(null,bytes(o),key).toString('base64url')};
}
export function verifyStatusCommand(envelope,key,engineId,now=Date.now()){
 try{
  if(!exact(envelope,['command','signature'])||!valid(envelope.command,now)||envelope.command.engineId!==engineId||key?.type!=='public'||key.asymmetricKeyType!=='ed25519'||typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))return false;
  const sig=Buffer.from(envelope.signature,'base64url');
  return sig.length===64&&sig.toString('base64url')===envelope.signature&&verify(null,bytes(envelope.command),key,sig);
 }catch{return false}
}
// Status-only preparation. No network, privileged execution, source connection,
// production route, or worker admission. A real transport must consume challenges
// atomically and use independent per-worker identity and signed responses.
