import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOneMoviePilot} from '../src/one-movie-pilot.mjs';

const sourceId='123e4567-e89b-42d3-a456-426614174000';
const base={
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40),
 BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:'204',
 BLOFY_CONTENT_HUB_EXPECTED_BYTES:String(16*1024**2)
};
test('an individually leased mirror movie uses the NEW per-item metadata route',async()=>{
 const urls=[];
 const result=await inspectOneMoviePilot({
  env:{...base,BLOFY_CONTENT_HUB_MIRROR_DYNAMIC_MOVIE_ENABLED:'1'},
  fetchImpl:async url=>{
   urls.push(String(url));return new Response(JSON.stringify({
    ok:true,sourceId,mediaId:'film_204',gatewayId:204,
    sourceName:'saleh',extension:'mp4',mediaKind:'movie'
   }),{status:200,headers:{'content-type':'application/json'}})
  }
 });
 assert.equal(result.ok,true);
 assert.equal(result.gatewayId,204);
 assert.equal(result.approvedMovieMatches,true);
 assert.equal(urls.length,1);
 assert.match(urls[0],/\/internal\/blofy-content-hub\/mirror\/movie\/204\/describe$/);
});
test('existing owner movie bridge route remains unchanged without dynamic opt-in',async()=>{
 const urls=[];
 await inspectOneMoviePilot({
  env:base,fetchImpl:async url=>{
   urls.push(String(url));return new Response(JSON.stringify({
    sourceId,mediaId:'film_204',gatewayId:204,
    sourceName:'saleh',extension:'mp4',mediaKind:'movie'
   }),{status:200})
  }
 });
 assert.match(urls[0],/\/internal\/blofy-content-hub\/describe$/);
});
test('dynamic movie refuses missing exact gateway ID',async()=>{
 let requests=0;
 const r=await inspectOneMoviePilot({
  env:{...base,BLOFY_CONTENT_HUB_MIRROR_DYNAMIC_MOVIE_ENABLED:'1',
   BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:''},
  fetchImpl:async()=>{requests++;throw Error('not_called')}
 });
 assert.equal(r.ok,false);
 assert.equal(requests,0);
});
