import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import http from 'node:http';
import test from 'node:test';
import {createGatewayTsRoute} from '../src/blofy-engine-gateway-ts-route.mjs';

const sourceId=randomUUID();
const accountId=randomUUID();
const channelId='123';
const legacyPath='/live/test-user/test-password/24680';
const hostbrr={mode:'engine',state:'ready',sourceId,channelId,engineId:'hostbrr',
 reservationId:randomUUID(),generation:'a'.repeat(32)};
const linode={...hostbrr,engineId:'linode',reservationId:randomUUID(),generation:'b'.repeat(32)};
const ts=Buffer.alloc(188,0x47);
const manifest='#EXTM3U\n#EXT-X-TARGETDURATION:2\n'+[0,1,2].map(n=>'#EXTINF:2,\nseg-'+String(n).padStart(9,'0')+'.ts\n').join('');

test('old TS URL supports HEAD and reconnects across committed engine changes', {timeout:8000}, async()=>{
 let feed=hostbrr,authorized=true,legacy=0;
 const requests=[],closed=[];
 const releases=new Set();
 let whenClosed;
 const ledger={
  async attachViewer(viewer){
   assert.equal(viewer.requireEngineGate,true);
   assert.equal(viewer.proxied,true);
   assert.equal(viewer.accountId,accountId);
   assert.equal(viewer.channelId,channelId);
   assert.equal(viewer.reservationId,feed.reservationId);
   assert.ok(!releases.has(viewer.sessionId));
   return {ok:true,expiresAt:new Date(Date.now()+30000).toISOString()};
  },
  async closeViewer(viewer){
   releases.add(viewer.sessionId);
   closed.push(viewer);
   whenClosed?.();
  }
 };
 const route=createGatewayTsRoute({enabled:true,sourceId,testAccountId:accountId,ledger,
  keys:{hostbrr:Buffer.alloc(32,1),linode:Buffer.alloc(32,2)},
  readOwnedFeed:async()=>feed,
  readProof:async identity=>({...identity,observedAt:Date.now()}),
  recheck:async()=>({ok:authorized,accountQuota:1,authorizedUntil:new Date(Date.now()+60000).toISOString()}),
  fetchImpl:async input=>{
   const url=new URL(input);
   requests.push(url);
   if(url.pathname.endsWith('/index.m3u8'))return new Response(manifest);
   return new Response(ts,{headers:{'content-type':'video/mp2t','content-length':String(ts.length)}});
  }
 });
 const server=http.createServer(async(req,res)=>{
  const extension=req.url.slice(legacyPath.length+1);
  if(await route(req,res,{account:{id:accountId},row:{server_id:sourceId,source_id:channelId},kind:'live',extension}))return;
  legacy++;
  res.writeHead(204).end();
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port+legacyPath;
 try{
  const head=await fetch(base+'.TS',{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(head.headers.get('content-type'),'video/mp2t');
  assert.equal(head.headers.get('location'),null);
  assert.equal(requests.length,0);

  for(const engine of [hostbrr,linode]){
   feed=engine;
   const before=requests.length;
   const finished=new Promise(resolve=>{whenClosed=resolve;});
   const response=await fetch(base);
   assert.equal(response.status,200);
   assert.equal(response.headers.get('content-type'),'video/mp2t');
   assert.equal(response.headers.get('location'),null);
   const reader=response.body.getReader();
   const part=await reader.read();
   assert.ok(part.value.length>=188);
   assert.equal(part.value[0],0x47);
   await reader.cancel();
   await finished;
   const workerRequests=requests.slice(before);
   assert.ok(workerRequests.length>=2);
   for(const url of workerRequests){
    assert.equal(url.host,engine===hostbrr?'media2.blofyplayer.com':'media.blofyplayer.com');
    assert.equal(url.pathname.split('/')[2],engine.generation);
   }
   assert.equal(closed.at(-1).reservationId,engine.reservationId);
  }
  assert.equal(closed.length,2);

  authorized=false;
  const before=requests.length;
  const refused=await fetch(base+'.ts');
  assert.equal(refused.status,503);
  await refused.body.cancel();
  assert.equal(requests.length,before);
  assert.equal(legacy,0);

  feed={mode:'legacy'};
  assert.equal((await fetch(base+'.ts')).status,204);
  assert.equal(legacy,1);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
});
