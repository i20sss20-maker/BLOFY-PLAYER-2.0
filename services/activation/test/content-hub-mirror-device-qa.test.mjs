import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {
 mintOwnerDeviceQaTicket,verifyOwnerDeviceQaTicket,
 forwardOwnerDeviceQaPlayback
} from '../src/content-hub-device-qa.mjs';

const base64urlAlphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function nonCanonicalHmacAlias(ticket){
 const final=ticket.at(-1),number=base64urlAlphabet.indexOf(final);
 assert.ok(number>=0);
 // Signature is 32 bytes -> 43 base64url chars; the last 2 pad
 // bits must be 0 in canonical encoding, but a decoder ignores them.
 assert.equal(number%4,0);
 return ticket.slice(0,-1)+base64urlAlphabet[number+1];
}
const secret='S'.repeat(64),runId='mirror_'+'a'.repeat(40);
const env={BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED:'1',
 BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY:secret};

test('movie/episode tickets are bound to kind, run and valid device platform',()=>{
 const now=Date.UTC(2026,10,15,5,0);
 const a=mintOwnerDeviceQaTicket({secret,runId,
  mediaKind:'movie',platform:'android_tv',now});
 assert.equal(a.mediaKind,'movie');
 assert.equal(a.platform,'android_tv');
 assert.equal(verifyOwnerDeviceQaTicket({secret,ticket:a.ticket,
  runId,mediaKind:'movie',platform:'android_tv',now}),true);
 assert.equal(verifyOwnerDeviceQaTicket({secret,ticket:a.ticket,
  runId,mediaKind:'movie',platform:'windows',now}),false);
 assert.equal(verifyOwnerDeviceQaTicket({
  secret,ticket:nonCanonicalHmacAlias(a.ticket),runId,
  mediaKind:'movie',platform:'android_tv',now}),false);
 assert.equal(verifyOwnerDeviceQaTicket({secret,ticket:a.ticket,
  runId,mediaKind:'episode',now}),false);
 assert.equal(verifyOwnerDeviceQaTicket({secret,ticket:a.ticket,
  runId,mediaKind:'movie',now:now+15*60000}),false);
 assert.throws(()=>mintOwnerDeviceQaTicket({
  secret,runId,mediaKind:'live',platform:'windows'}),/issue_invalid/);
 assert.throws(()=>mintOwnerDeviceQaTicket({
  secret,runId,mediaKind:'movie',platform:'unknown'}),/issue_invalid/);
});
test('movie owner QA GET is a capped 206 relay from private S3 only',async()=>{
 const data=Buffer.from('NONMEDIA-SYNTHETIC-PRIVATE-SAMPLE');
 let reads=0,heads=0;
 const requestHub=async(path,opts)=>{
  assert.equal(path,'/internal/pilot/playback/'+runId);
  if(opts.method==='HEAD'){
   heads++;return {status:200,headers:new Headers({
    'content-length':String(data.length),'content-type':'video/mp4'
   })};
  }
  reads++;
  const match=/^bytes=(\d+)-(\d+)$/.exec(opts.range);
  const from=Number(match[1]),to=Number(match[2]);
  return {status:206,headers:new Headers({
   'content-range':'bytes '+from+'-'+to+'/'+data.length,
   'content-length':String(to-from+1),'content-type':'video/mp4'
  }),body:ReadableStream.from?ReadableStream.from([data.subarray(from,to+1)]):
   new ReadableStream({start(controller){
    controller.enqueue(data.subarray(from,to+1));controller.close();
   }})};
 };
 const server=createServer((req,res)=>forwardOwnerDeviceQaPlayback({
  req,res,runId,mediaKind:'movie',requirePlatform:true,env,requestHub
 }));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/relay';
  assert.equal((await fetch(url,{method:'GET',headers:{range:'bytes=1-4'}})).status,401);
  assert.equal(reads,0);
  const ticket=mintOwnerDeviceQaTicket({secret,runId,
   mediaKind:'movie',platform:'windows'}).ticket;
  const headers={authorization:'Bearer '+ticket,range:'bytes=1-4',
   'x-blofy-device-platform':'windows'};
  assert.equal((await fetch(url+'?ticket=bad',{headers})).status,404);
  assert.equal(reads,0);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+ticket}})).status,401);
  assert.equal((await fetch(url,{headers:{...headers,
   'x-blofy-device-platform':'android_tv'}})).status,401);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+ticket,
   'x-blofy-device-platform':'windows'}})).status,416);
  const response=await fetch(url,{headers});
  assert.equal(response.status,206);
  assert.equal(response.headers.get('cache-control'),'private,no-store');
  assert.equal(await response.text(),data.subarray(1,5).toString());
  assert.ok(heads>=2);
  assert.equal(reads,1);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
