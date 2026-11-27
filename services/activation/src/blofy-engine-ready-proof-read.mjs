import {createPublicKey,sign,verify,timingSafeEqual,randomBytes} from 'node:crypto';
const pin='MCowBQYDK2VwAyEAxtbHHm7Ic1yMvEAldZh36zPYHCvllmh9KqgM6mxS0P4=';
const fields=['engineId','sourceId','channelId','reservationId','generation'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{32}$/;
const valid=i=>i&&['linode','hostbrr'].includes(i.engineId)&&uuid.test(i.sourceId??'')&&uuid.test(i.reservationId??'')&&/^[1-9][0-9]{0,14}$/.test(i.channelId??'')&&hex.test(i.generation??'');
const same=(a,b)=>valid(a)&&valid(b)&&fields.every(k=>a[k]===b[k]);
const encode=p=>Buffer.from(JSON.stringify(['BLOFY_READY_READ_V1',p.nonce,...fields.map(k=>p[k]),p.observedAt,p.lastSegment]));
// Controller attests only fresh worker proof for the current committed feed.
// Never certifies provider release, capacity or viewer permission.
export function createReadyProofRead({secret,controllerKey,readProof,clock=Date.now,enabled=false}={}){
 return async function read(e,bearer){
  const denied=(code)=>({code,body:{ok:false}});
  if(!enabled||typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))return denied(503);
  const a=Buffer.from(String(bearer??'')),b=Buffer.from('Bearer '+secret);
  if(a.length!==b.length||!timingSafeEqual(a,b))return denied(403);
  if(!valid(e)||!hex.test(e.nonce??''))return denied(400);
  const p=await readProof(e),now=clock();
  if(!same(e,p)||p.status!=='private_hls_ready'||p.localSourceConnections!==1||
     !Number.isSafeInteger(p.observedAt)||p.observedAt<now-10000||p.observedAt>now+2000||
     !Number.isSafeInteger(p.lastSegment)||p.lastSegment<0)return denied(503);
  const proof={nonce:e.nonce,...Object.fromEntries(fields.map(k=>[k,p[k]])),observedAt:p.observedAt,lastSegment:p.lastSegment};
  return {code:200,body:{ok:true,proof,signature:sign(null,encode(proof),controllerKey).toString('base64url')}};
 };
}
export function verifyReadyProof(e,identity,nonce,{key=createPublicKey({key:Buffer.from(pin,'base64'),format:'der',type:'spki'}),now=Date.now()}={}){
 try{
  const p=e?.proof;
  return e?.ok===true&&same(p,identity)&&hex.test(nonce)&&p.nonce===nonce&&
   Number.isSafeInteger(p.observedAt)&&p.observedAt>=now-10000&&p.observedAt<=now+2000&&
   Number.isSafeInteger(p.lastSegment)&&p.lastSegment>=0&&/^[A-Za-z0-9_-]{86}$/.test(e.signature)&&
   verify(null,encode(p),key,Buffer.from(e.signature,'base64url'))?p:null;
 }catch{return null}
}
export function createReadyProofReader({secret,fetchImpl=fetch,clock=Date.now,enabled=false}={}){
 return async identity=>{
  if(!enabled||!valid(identity)||!/^[a-f0-9]{64}$/.test(secret??''))return null;
  try{
   const nonce=randomBytes(16).toString('hex');
   const r=await fetchImpl('https://blofy-engine-control-qa-production.up.railway.app/control/feed-proof/read',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'content-type':'application/json',authorization:'Bearer '+secret},
    body:JSON.stringify({...Object.fromEntries(fields.map(k=>[k,identity[k]])),nonce})
   });
   if(r.status!==200||!r.body){await r.body?.cancel().catch(()=>{});return null}
   const reader=r.body.getReader(),parts=[];let n=0;
   try{for(;;){const c=await reader.read();if(c.done)break;n+=c.value.byteLength;if(n>2048)return null;parts.push(Buffer.from(c.value))}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   return verifyReadyProof(JSON.parse(Buffer.concat(parts).toString('utf8')),identity,nonce,{now:clock()});
  }catch{return null}
 };
}
