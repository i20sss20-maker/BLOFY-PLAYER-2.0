import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';
import {inspectEpisodeCandidates} from '../src/episode-candidates.mjs';

const token='owner-operator-only-bridge-token-long-123';
const item={gatewayId:231,sourceId:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
 mediaId:'episode_23',title:'Season 1 Episode 2',extension:'mkv',
 mediaKind:'episode',sourceName:'saleh'};
test('source inspection is metadata only, with no provider media bytes',async()=>{
 let fetches=0;
 const result=await inspectEpisodeCandidates({
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:token},
  fetchImpl:async(url,opts)=>{
   fetches++;
   assert.ok(url.endsWith('/internal/blofy-content-hub/episodes/candidates'));
   assert.equal(opts.method,'GET');
   return Response.json({ok:true,readOnly:true,candidates:[item]});
  }
 });
 assert.equal(result.ok,true);
 assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].gatewayId,231);
 assert.equal(result.providerMediaRequests,0);
 assert.equal(result.customerCutover,false);
 assert.equal(result.automaticDownload,false);
 assert.equal(fetches,1);
});
test('episode preflight refuses malformed source records',async()=>{
 const result=await inspectEpisodeCandidates({
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:token},
  fetchImpl:async()=>Response.json({ok:true,readOnly:true,
   candidates:[{...item,sourceName:'other'}]})
 });
 assert.equal(result.ok,false);
 assert.equal(result.candidates.length,0);
 assert.equal(result.code,'episode_catalog_contains_invalid_item');
});
test('private owner-only episode candidates route blocks untrusted browsers',async()=>{
 let queries=0;
 const hub=createContentHubServer({token,storage:{},lease:{},
  episodeCandidateInspector:async()=>{
   queries++;return {ok:true,readOnly:true,privateOnly:true,
    candidates:[item],providerMediaRequests:0,
    customerCutover:false,automaticDownload:false}
  }});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const url='http://127.0.0.1:'+hub.server.address().port+
    '/internal/episodes/candidates';
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url+'?source=evil',{headers:{
   authorization:'Bearer '+token}})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{
   authorization:'Bearer '+token}})).status,404);
  assert.equal(queries,0);
  const response=await fetch(url,{headers:{authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).candidates.length,1);
  assert.equal(queries,1);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
