import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {
 enabledOwnerDeviceQa,mintOwnerDeviceQaTicket,
 verifyOwnerDeviceQaTicket,strictDeviceQaRange,
 forwardOwnerDeviceQaPlayback,DEVICE_QA_MAX_RANGE
} from '../src/content-hub-device-qa.mjs';
const secret='s'.repeat(64),runId='owner_verified_20261114';
const env={BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED:'1',
 BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY:secret};

test('fail closed until an explicit opt-in and long independent signing secret',()=>{
 assert.equal(enabledOwnerDeviceQa({}),false);
 assert.equal(enabledOwnerDeviceQa({...env,BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED:'0'}),false);
 assert.equal(enabledOwnerDeviceQa({...env,BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY:'small'}),false);
 assert.equal(enabledOwnerDeviceQa(env),true);
});

test('HMAC ticket cannot be forged, extended, replayed on another ID, or used after expiry',()=>{
 const issued=Date.UTC(2026,10,14,12,0),a=mintOwnerDeviceQaTicket({
  secret,runId,now:issued});
 assert.equal(a.privateOnly,true);
 assert.equal(a.customerCutover,false);
 assert.equal(a.mediaKind,'episode');
 assert.equal(verifyOwnerDeviceQaTicket({
  secret,ticket:a.ticket,runId,now:issued}),true);
 assert.equal(verifyOwnerDeviceQaTicket({
  secret,ticket:a.ticket,runId,now:issued+900000}),false);
 assert.equal(verifyOwnerDeviceQaTicket({
  secret,ticket:a.ticket,runId:'wrong_run_20261114',now:issued}),false);
 assert.equal(verifyOwnerDeviceQaTicket({
  secret:'x'.repeat(64),ticket:a.ticket,runId,now:issued}),false);
 assert.equal(verifyOwnerDeviceQaTicket({
  secret,ticket:a.ticket.slice(0,-1)+'A',runId,now:issued}),false);
 assert.notEqual(mintOwnerDeviceQaTicket({secret,runId,now:issued}).ticket,a.ticket);
 assert.throws(()=>mintOwnerDeviceQaTicket({secret,runId:'../bad'}));
 assert.equal(a.ticket.includes('https:'),false);
});

test('explicit ranges capped at 8 MiB; no suffix/open-ended/full file GET',()=>{
 assert.deepEqual(strictDeviceQaRange('bytes=0-3',50),{from:0,to:3,size:4});
 assert.equal(strictDeviceQaRange('bytes=0-',50),null);
 assert.equal(strictDeviceQaRange('bytes=-20',50),null);
 assert.equal(strictDeviceQaRange('bytes=0-10,13-15',50),null);
 assert.equal(strictDeviceQaRange('bytes=0-8388608',99999999),null);
 assert.deepEqual(strictDeviceQaRange('bytes=0-'+(DEVICE_QA_MAX_RANGE-1),
   99999999),{from:0,to:DEVICE_QA_MAX_RANGE-1,size:DEVICE_QA_MAX_RANGE});
});

test('owner ticket is required for real 206 relay from a verified exact run',async()=>{
 const data=Buffer.from('BLOFY-DUMMY-VERIFIED-EPISODE');
 let reads=0,heads=0;
 const requestHub=async(path,opts)=>{
  assert.equal(path,'/internal/episodes/playback/'+runId);
  assert.equal(opts.method==='HEAD'||opts.method==='GET',true);
  if(opts.method==='HEAD'){
   heads++;
   return {status:200,headers:new Headers({
    'content-length':String(data.length),'content-type':'video/mp4'
   })};
  }
  reads++;
  const m=/^bytes=(\d+)-(\d+)$/.exec(opts.range);
  const from=Number(m[1]),to=Number(m[2]);
  return {status:206,headers:new Headers({
   'content-range':`bytes ${from}-${to}/${data.length}`,
   'content-length':String(to-from+1),'content-type':'video/mp4'
  }),body:Readable.from([data.subarray(from,to+1)])};
 };
 const server=createServer(async(req,res)=>forwardOwnerDeviceQaPlayback({
  req,res,runId,env,requestHub
 }));
 server.listen(0,'127.0.0.1');
 try{
  await new Promise(done=>server.once('listening',done));
  const url='http://127.0.0.1:'+server.address().port+'/qa';
  assert.equal((await fetch(url,{headers:{range:'bytes=0-3'}})).status,401);
  assert.equal(reads,0);
  const ticket=mintOwnerDeviceQaTicket({secret,runId}).ticket;
  const auth={authorization:'Bearer '+ticket};
  const noRange=await fetch(url,{headers:auth});
  assert.equal(noRange.status,416);
  assert.equal(reads,0);
  const head=await fetch(url,{method:'HEAD',headers:auth});
  assert.equal(head.status,200);
  assert.equal(head.headers.get('content-length'),String(data.length));
  const response=await fetch(url,{headers:{...auth,range:'bytes=4-8'}});
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),
   'bytes 4-8/'+data.length);
  assert.equal(response.headers.get('cache-control'),'private,no-store');
  assert.equal(await response.text(),data.subarray(4,9).toString());
  assert.equal(reads,1);
  assert.ok(heads>=2);
  const bad=await fetch(url+'?token=secret',{
   headers:{...auth,range:'bytes=0-1'}});
  assert.equal(bad.status,404);
  assert.equal(reads,1);
 }finally{await new Promise(done=>server.close(done))}
});

test('private range relay never makes a source call when Hub metadata is unverified',async()=>{
 let reads=0;
 const requestHub=async()=>{reads++;return {status:404,headers:new Headers()}};
 const server=createServer(async(req,res)=>forwardOwnerDeviceQaPlayback({
  req,res,runId,env,requestHub
 }));
 server.listen(0,'127.0.0.1');
 try{
  await new Promise(done=>server.once('listening',done));
  const url='http://127.0.0.1:'+server.address().port+'/qa';
  const ticket=mintOwnerDeviceQaTicket({secret,runId}).ticket;
  const out=await fetch(url,{headers:{
   authorization:'Bearer '+ticket,range:'bytes=0-3'
  }});
  assert.equal(out.status,404);
  assert.equal(reads,1);
 }finally{await new Promise(done=>server.close(done))}
});
