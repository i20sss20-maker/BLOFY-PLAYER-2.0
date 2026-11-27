import {createServer} from 'node:http';
import {createPrivateKey,createPublicKey,generateKeyPairSync} from 'node:crypto';
import {mkdirSync,chmodSync,chownSync,readFileSync,writeFileSync,existsSync,statSync,renameSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createDurableStatusTransport} from '../../src/blofy-engine-durable-status.mjs';
import {createLiveLeasePoll} from '../../src/blofy-live-lease-poll.mjs';
import {createFeedProofTransport} from '../../src/blofy-live-feed-proof-transport.mjs';
import {createBoundedPilotPermit} from '../../src/blofy-bounded-pilot-permit.mjs';
import {signAuthorityRead} from '../../src/blofy-engine-authority-read.mjs';
if(process.env.BLOFY_DURABLE_STATUS_ENABLED!=='1')throw Error('disabled');
const root='/data/control';
if(!existsSync('/data')||!statSync('/data').isDirectory())throw Error('persistent_volume_required');
if(process.getuid()===0){
 mkdirSync(root,{recursive:true,mode:0o700});chownSync(root,1000,1000);chmodSync(root,0o700);
 process.setgroups([]);process.setgid(1000);process.setuid(1000);
}
process.umask(0o077);
const keyPath=root+'/controller.pem';
if(!existsSync(keyPath)){
 const key=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
 writeFileSync(keyPath+'.new',key,{mode:0o600,flag:'w'});
 renameSync(keyPath+'.new',keyPath);
}
const controllerKey=createPrivateKey(readFileSync(keyPath));
if(controllerKey.asymmetricKeyType!=='ed25519')throw Error('controller_key_invalid');
const publicKey=createPublicKey(controllerKey).export({type:'spki',format:'der'}).toString('base64');
const pins={linode:'MCowBQYDK2VwAyEArpMic8QQuCg/6+q89qmP6cslqKPBfRI/MjGfbvsCUcA=',hostbrr:'MCowBQYDK2VwAyEAgix7KGEHl4YmO9+1wga6rWt2Ocz80nCszBOgHC0KVeE='};
const workerKeys=Object.fromEntries(Object.entries(pins).map(([id,k])=>[id,createPublicKey({key:Buffer.from(k,'base64'),format:'der',type:'spki'})]));
const db=new DatabaseSync(root+'/status.sqlite');
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
const transport=createDurableStatusTransport(db,{controllerKey,workerKeys});
const pilot=createBoundedPilotPermit(db,{controllerKey,workerKeys});
// Inert transport until the authoritative source fence and ledger are connected.
const liveLeasePoll=createLiveLeasePoll({db,controllerKey,workerKeys,enabled:false});
// Proof collection reads committed production state, never grants a lease.
const feedProof=createFeedProofTransport({db,workerKeys,enabled:process.env.BLOFY_ENGINE_FEED_PROOF_READ==='1',readReservation:async engineId=>{
 try{const s=await readAuthority();return s.mode==='engine'&&s.gateReservationMatches===true&&s.registeredLegacyHolds===0&&s.reservation?.sourceId===s.sourceId&&s.reservation?.engineId===engineId?s.reservation:null;}catch{return null}
}});
// Read-only production link; no worker activation or source requests.
async function readAuthority(){
  const r=await fetch('https://blofy-activation-portal-production.up.railway.app/internal/engine-authority-read',{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'content-type':'application/json'},body:JSON.stringify(signAuthorityRead(controllerKey))});
  if(r.status!==200){await r.body?.cancel().catch(()=>{});throw Error('authority_unavailable')}
  const reader=r.body?.getReader();if(!reader)throw Error('authority_body_missing');
  let size=0,parts=[];
  try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.byteLength;if(size>2048)throw Error('authority_body_too_large');parts.push(Buffer.from(c.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const s=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(s.ok!==true||!['legacy','draining','engine','unknown'].includes(s.mode)||!Number.isSafeInteger(s.registeredLegacyHolds)||s.registeredLegacyHolds<0||s.allPathsFenced!==false||!Number.isSafeInteger(s.observedAt)||Math.abs(Date.now()-s.observedAt)>5000)throw Error('authority_invalid');
  return s;
}
const authorityProbe=async()=>{
 try{
  const s=await readAuthority();
  console.log('BLOFY_ENGINE_AUTHORITY_LINK '+JSON.stringify({ok:true,mode:s.mode,registeredLegacyHolds:s.registeredLegacyHolds,reservationState:s.reservation?.state??null,allPathsFenced:false,customerTrafficChanged:false}));
 }catch{console.log('BLOFY_ENGINE_AUTHORITY_LINK '+JSON.stringify({ok:false,customerTrafficChanged:false}));}
};
if(process.env.BLOFY_ENGINE_AUTHORITY_PROBE==='1'){
 const first=setTimeout(()=>void authorityProbe(),5000);first.unref();
 const periodic=setInterval(()=>void authorityProbe(),60000);periodic.unref();
}
const logged=new Map();
const reply=(res,code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 try{
  const installers=new Set(['bounded-pilot-worker.py','blofy_live_lease_guard.py','live_runtime_leased_candidate.py','blofy-live-lease-agent.py','blofy-live-feed-proof-worker.py']);
  const installer=req.url?.startsWith('/install/')?req.url.slice(9):'';
  if(req.method==='GET'&&installers.has(installer)){
   const body=readFileSync(new URL('../'+(installer==='bounded-pilot-worker.py'?'blofy-bounded-pilot-worker.py':installer),import.meta.url));
   res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':body.length});return res.end(body);
  }
  if(req.method==='GET'&&req.url==='/healthz'){db.prepare('SELECT 1').get();return reply(res,200,{ok:true,mode:'status-only'});}
  if(req.method!=='POST'||!['/control/status/poll','/control/status/complete','/control/pilot/poll','/control/lease/poll','/control/feed-proof/poll','/control/feed-proof/complete'].includes(req.url))return reply(res,404,{ok:false});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{ok:false});
  let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>4096){req.destroy();return;}chunks.push(c);}
  const e=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(req.url==='/control/feed-proof/poll'){const r=await feedProof.poll(e);return reply(res,r.code,r.body);}
  if(req.url==='/control/feed-proof/complete'){const r=await feedProof.complete(e);return reply(res,r.code,r.body);}
  if(req.url==='/control/lease/poll'){const r=await liveLeasePoll(e);return reply(res,r.code,r.body);}
  if(req.url==='/control/pilot/poll'){const r=pilot(e);return reply(res,r.code,r.body);}
  const poll=req.url.endsWith('/poll');
  const r=poll?transport.poll(e):transport.complete(e);
  if(!poll&&r.code===200){const {engineId,deliveryActive,heartbeatActive}=r.body,now=Date.now(),previous=logged.get(engineId);
   const state=String(deliveryActive)+':'+String(heartbeatActive);
   if(!previous||previous.state!==state||now-previous.time>=60000){console.log('BLOFY_DURABLE_STATUS '+JSON.stringify(r.body));logged.set(engineId,{state,time:now});}}
  return reply(res,r.code,r.body);
 }catch{if(!res.headersSent)reply(res,400,{ok:false});else res.end();}
});
server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=32;
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('BLOFY_DURABLE_CONTROLLER_PUBLIC_DER '+publicKey));
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{server.close(()=>{db.close();process.exit(0)});server.closeAllConnections()});
