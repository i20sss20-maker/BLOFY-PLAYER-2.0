import http from 'node:http';
import {createPublicKey,generateKeyPairSync} from 'node:crypto';
import {createStatusPollQa} from '../../src/blofy-engine-status-poll-qa.mjs';
import {verifyWorkerStatus} from '../../src/blofy-engine-status-response.mjs';
const pins={linode:'MCowBQYDK2VwAyEArpMic8QQuCg/6+q89qmP6cslqKPBfRI/MjGfbvsCUcA=',hostbrr:'MCowBQYDK2VwAyEAgix7KGEHl4YmO9+1wga6rWt2Ocz80nCszBOgHC0KVeE='};
if(process.env.BLOFY_ENGINE_QA_RUN!=='1'){console.log('QA_DISABLED');process.exit(0);}
const workerKeys=Object.fromEntries(Object.entries(pins).map(([id,k])=>[id,createPublicKey({key:Buffer.from(k,'base64'),format:'der',type:'spki'})]));
const controller=generateKeyPairSync('ed25519');
const qa=createStatusPollQa({controllerKey:controller.privateKey,workerKeys});
const seen=new Map(),completed=new Set();
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/healthz')return reply(res,200,{ok:true});
  if(req.method!=='POST'||!['/qa/poll','/qa/complete'].includes(req.url))return reply(res,404,{ok:false});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{ok:false});
  let n=0;const chunks=[];
  for await(const c of req){n+=c.length;if(n>4096){req.destroy();return;}chunks.push(c);}
  const e=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const id=e?.status?.engineId,challenge=e?.status?.challenge,now=Date.now();
  if(!Object.hasOwn(workerKeys,id)||!verifyWorkerStatus(e,{publicKey:workerKeys[id],engineId:id,challenge,now}))return reply(res,403,{ok:false});
  if(req.url==='/qa/poll'){
   for(const [k,t] of seen)if(t<now)seen.delete(k);
   const k=id+':'+challenge;
   if(seen.has(k)||seen.size>=256)return reply(res,429,{ok:false});
   seen.set(k,now+32000);
   return reply(res,200,qa.poll(id));
  }
  const result=qa.complete(id,e);
  if(!result.ok)return reply(res,409,{ok:false});
  console.log('QA_REVERSE_STATUS '+JSON.stringify(result));
  if(result.deliveryActive&&result.heartbeatActive)completed.add(id);
  if(completed.size===2)console.log('BLOFY_RAILWAY_REVERSE_QA_PASS');
  return reply(res,200,result);
 }catch{if(!res.headersSent)reply(res,400,{ok:false});else res.end();}
});
server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=32;
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('QA_CONTROLLER_PUBLIC_DER '+controller.publicKey.export({type:'spki',format:'der'}).toString('base64')));
setTimeout(()=>{server.close();server.closeAllConnections();console.log('QA_REVERSE_FINISHED');},20*60*1000).unref();
