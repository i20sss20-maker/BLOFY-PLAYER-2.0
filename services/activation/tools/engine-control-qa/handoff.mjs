import http from 'node:http';
import {createPublicKey,generateKeyPairSync,randomBytes,sign,verify} from 'node:crypto';
import {createSyntheticHandoffQa} from '../../src/blofy-engine-synthetic-handoff-qa.mjs';
import {verifyWorkerStatus} from '../../src/blofy-engine-status-response.mjs';
if(process.env.BLOFY_ENGINE_QA_RUN!=='1')process.exit(0);
const pins={linode:'MCowBQYDK2VwAyEArpMic8QQuCg/6+q89qmP6cslqKPBfRI/MjGfbvsCUcA=',hostbrr:'MCowBQYDK2VwAyEAgix7KGEHl4YmO9+1wga6rWt2Ocz80nCszBOgHC0KVeE='};
const keys=Object.fromEntries(Object.entries(pins).map(([id,k])=>[id,createPublicKey({key:Buffer.from(k,'base64'),format:'der',type:'spki'})]));
const controller=generateKeyPairSync('ed25519'),qa=createSyntheticHandoffQa(),seen=new Map();
let pending=null;
const bytes=(tag,values)=>Buffer.from(JSON.stringify([tag,...values]));
const fields=['version','engineId','operation','challenge','issuedAt','expiresAt'];
const proofFields=['version','engineId','operation','challenge','observedAt','status'];
const exact=(o,f)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===f.slice().sort().join(',');
const reply=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj));};
function expire(now){if(pending&&pending.command.expiresAt<=now){qa.uncertain();pending=null;console.log('QA_HANDOFF_HOLD expired');}}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/healthz')return reply(res,200,{ok:true});
  if(req.method!=='POST'||!['/qa/handoff/poll','/qa/handoff/complete'].includes(req.url))return reply(res,404,{ok:false});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{ok:false});
  const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>4096){req.destroy();return}chunks.push(c);}
  const e=JSON.parse(Buffer.concat(chunks).toString('utf8')),now=Date.now();
  expire(now);
  if(req.url.endsWith('/poll')){
   const id=e?.status?.engineId,challenge=e?.status?.challenge;
   if(!Object.hasOwn(keys,id)||!verifyWorkerStatus(e,{publicKey:keys[id],engineId:id,challenge,now}))return reply(res,403,{ok:false});
   for(const [k,t] of seen)if(t<now)seen.delete(k);
   const k=id+':'+challenge;if(seen.has(k)||seen.size>=256)return reply(res,429,{ok:false});
   seen.set(k,now+32000);
   const next=qa.next(),state=qa.snapshot().state;
   if(!next)return reply(res,200,{state});
   if(next.engineId!==id)return reply(res,200,{state:'wait'});
   if(!pending){
    const command={version:1,engineId:id,operation:next.operation,challenge:randomBytes(16).toString('hex'),issuedAt:now,expiresAt:now+60000};
    pending={command,signature:sign(null,bytes('BLOFY_SYNTHETIC_COMMAND_V1',fields.map(k=>command[k])),controller.privateKey).toString('base64url')};
   }
   return reply(res,200,pending);
  }
  const p=e?.proof,c=pending?.command;
  if(!c||!exact(e,['proof','signature'])||!exact(p,proofFields)||p.version!==1||p.engineId!==c.engineId||p.operation!==c.operation||p.challenge!==c.challenge||
     !Number.isSafeInteger(p.observedAt)||p.observedAt<c.issuedAt-2000||p.observedAt>now+2000||p.observedAt<now-30000||
     typeof e.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(e.signature))return reply(res,403,{ok:false});
  const sig=Buffer.from(e.signature,'base64url');
  if(sig.length!==64||sig.toString('base64url')!==e.signature||!verify(null,bytes('BLOFY_SYNTHETIC_PROOF_V1',proofFields.map(k=>p[k])),keys[p.engineId],sig))return reply(res,403,{ok:false});
  if(!qa.acknowledge({...p,scope:'synthetic-only',verified:true})){qa.uncertain();pending=null;return reply(res,409,{ok:false});}
  pending=null;const state=qa.snapshot().state;
  console.log('QA_HANDOFF_STEP '+JSON.stringify({engineId:p.engineId,operation:p.operation,status:p.status,state}));
  if(state==='passed')console.log('BLOFY_SYNTHETIC_HANDOFF_PASS');
  return reply(res,200,{ok:true,state});
 }catch{if(!res.headersSent)reply(res,400,{ok:false});else res.end();}
});
server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=32;
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('QA_HANDOFF_CONTROLLER_PUBLIC_DER '+controller.publicKey.export({type:'spki',format:'der'}).toString('base64')));
setTimeout(()=>{qa.uncertain();server.close();server.closeAllConnections();console.log('QA_HANDOFF_FINISHED');},20*60*1000).unref();
