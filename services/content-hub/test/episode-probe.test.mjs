import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';
import {inspectEpisodeSize} from '../src/episode-probe.mjs';
const secret='K'.repeat(40);
test('one episode probe validates private source size response, no storage writes',async()=>{
 let requests=0;
 const result=await inspectEpisodeSize({
  gatewayId:432,env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:secret},
  fetchImpl:async(url,init)=>{
   requests++;
   assert.ok(url.endsWith('/episodes/probe/432'));
   assert.equal(init.method,'GET');
   assert.equal(init.headers['x-blofy-episode-probe'],'operator-confirmed');
   return Response.json({ok:true,code:'episode_4k_size_verified',
    gatewayId:432,sourceName:'saleh',extension:'mkv',
    expectedBytes:2193324000,probeBytes:4096,validatorPresent:false});
  }
 });
 assert.equal(requests,1);
 assert.equal(result.ok,true);
 assert.equal(result.expectedBytes,2193324000);
 assert.equal(result.probeBytes,4096);
 assert.equal(result.providerMediaRequests,1);
 assert.equal(result.stored,false);
 assert.equal(result.customerCutover,false);
});
test('episode probe prevents incorrect media ID and unverified source metadata',async()=>{
 const a=await inspectEpisodeSize({gatewayId:432,
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:secret},
  fetchImpl:async()=>Response.json({ok:true,code:'episode_4k_size_verified',
   gatewayId:123,sourceName:'other',extension:'mkv',
   expectedBytes:2193324000,probeBytes:4096})});
 assert.equal(a.ok,false);
 assert.equal(a.code,'episode_size_response_invalid');
});
test('private episode size endpoint requires bearer, deliberate confirmation and ID',async()=>{
 let count=0;
 const hub=createContentHubServer({token:secret,storage:{},lease:{},
  episodeSizeInspector:async({gatewayId})=>{
   count++;return {ok:true,code:'episode_size_preflight_verified',
    expectedBytes:100000000,probeBytes:4096,
    gatewayId,stored:false,customerCutover:false};
  }});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const url='http://127.0.0.1:'+hub.server.address().port+
   '/internal/episodes/probe';
  assert.equal((await fetch(url,{method:'POST'})).status,401);
  const headers={authorization:'Bearer '+secret};
  assert.equal((await fetch(url,{method:'POST',headers})).status,403);
  assert.equal((await fetch(url+'?id=432',{method:'POST',
   headers:{...headers,'x-blofy-episode-probe-confirm':'operator-approved-probe',
    'x-blofy-episode-gateway-id':'432'}})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{
    ...headers,'x-blofy-episode-probe-confirm':'operator-approved-probe',
    'x-blofy-episode-gateway-id':'bad'}})).status,400);
  assert.equal(count,0);
  const success=await fetch(url,{method:'POST',headers:{
    ...headers,'x-blofy-episode-probe-confirm':'operator-approved-probe',
    'x-blofy-episode-gateway-id':'432'}});
  assert.equal(success.status,200);
  assert.equal((await success.json()).expectedBytes,100000000);
  assert.equal(count,1);
  const retry=await fetch(url,{method:'POST',headers:{
    ...headers,'x-blofy-episode-probe-confirm':'operator-approved-probe',
    'x-blofy-episode-gateway-id':'432'}});
  assert.equal(retry.status,429);
  assert.equal(count,1);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
