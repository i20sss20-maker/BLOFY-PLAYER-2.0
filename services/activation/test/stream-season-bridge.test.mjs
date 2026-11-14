import test from 'node:test';
import assert from 'node:assert/strict';
import {isStreamSeasonBridgePath,requestStreamSeasonBridge}
 from '../src/stream-season-bridge.mjs';
const NS='/internal/blofy-stream/content-hub/seasons';
const secret='k'.repeat(48);
function stub(expectedPath,{status=200,data={ok:true}}={}){
 let calls=0,received=null;
 const fetchImpl=async(url,init)=>{
  calls++;received={url,init};
  assert.equal(url,'http://blofy-content-hub.railway.internal:3000'+expectedPath);
  assert.equal(init.headers.authorization,'Bearer '+secret);
  assert.equal(init.redirect,'manual');
  return {status,headers:new Headers({'content-type':'application/json'}),
   text:async()=>JSON.stringify(data)};
 };
 return {fetchImpl,get calls(){return calls},get received(){return received}};
}
test('season bridge permits only explicit finite authenticated actions',async()=>{
 for(const name of ['series','pilot','queue','confirmation','probe',
  'enqueue','start','pause','confirm','series/31']){
  assert.equal(isStreamSeasonBridgePath(NS+'/'+name),true,name);
 }
 for(const bad of ['..','series/../../../xx','series/0','arbitrary',
  'https://example.com/','series/31?test=1']){
  assert.equal(isStreamSeasonBridgePath(NS+'/'+bad),false,bad);
 }
 assert.equal((await requestStreamSeasonBridge({path:NS+'/queue',
  operatorToken:'short'})).status,503);
});
test('read licensed series, season detail and queue via private token',async()=>{
 const specs=[
  ['series','/internal/series/candidates'],
  ['pilot','/internal/series/pilot'],
  ['series/31','/internal/series/episodes/31'],
  ['queue','/internal/seasons/queue'],
  ['confirmation','/internal/episodes/playback/confirmation']
 ];
 for(const [name,target] of specs){
  const testFetch=stub(target);
  const result=await requestStreamSeasonBridge({path:NS+'/'+name,
   operatorToken:secret,fetchImpl:testFetch.fetchImpl});
  assert.equal(result.status,200);
  assert.equal(testFetch.calls,1);
  assert.equal(testFetch.received.init.method,'GET');
 }
});
test('enqueue requires exact rights and bounded licensed episode selection',async()=>{
 const t=stub('/internal/seasons/enqueue',{status:201,
  data:{ok:true,added:1}});
 const input={confirmed:true,licensedStorage:true,seriesGatewayId:31,
  seasonNumber:2,episodes:[{gatewayId:42,episodeNumber:1,
   expectedBytes:8388608}]};
 assert.equal((await requestStreamSeasonBridge({path:NS+'/enqueue',
  method:'POST',body:{...input,licensedStorage:false},operatorToken:secret,
  fetchImpl:t.fetchImpl})).status,400);
 assert.equal((await requestStreamSeasonBridge({path:NS+'/enqueue',
  method:'POST',body:{...input,episodes:[{...input.episodes[0],
   expectedBytes:4}]},operatorToken:secret,
  fetchImpl:t.fetchImpl})).status,400);
 assert.equal(t.calls,0);
 const response=await requestStreamSeasonBridge({path:NS+'/enqueue',
  method:'POST',body:input,operatorToken:secret,fetchImpl:t.fetchImpl});
 assert.equal(response.status,201);
 assert.equal(t.received.init.headers['x-blofy-season-confirm'],
  'licensed-private-episodes');
 assert.equal(t.received.init.headers['x-blofy-storage-rights-confirm'],
  'licensed-persistent-copy');
 assert.deepEqual(JSON.parse(t.received.init.body),{
  seriesGatewayId:31,seasonNumber:2,episodes:input.episodes});
});
test('operator start, pause, probe and browser AV require explicit confirmations',async()=>{
 const specs=[
  ['probe','/internal/episodes/probe',
   {confirmed:true,gatewayId:42},'x-blofy-episode-gateway-id','42'],
  ['start','/internal/seasons/start',
   {confirmed:true,sourceIdle:true,licensedStorage:true},
   'x-blofy-season-confirm','start-private-sequential'],
  ['pause','/internal/seasons/pause',
   {confirmed:true},'x-blofy-season-confirm','pause-private-sequential'],
  ['confirm','/internal/episodes/playback/confirm',
   {confirmed:true,videoConfirmed:true,audioConfirmed:true},
   'x-blofy-browser-confirm','owner-saw-and-heard']
 ];
 for(const [action,target,body,header,expected] of specs){
  const t=stub(target,{status:202});
  const rejected=await requestStreamSeasonBridge({path:NS+'/'+action,
   method:'POST',body:{},operatorToken:secret,fetchImpl:t.fetchImpl});
  assert.equal(rejected.status,400);
  assert.equal(t.calls,0);
  const valid=await requestStreamSeasonBridge({path:NS+'/'+action,
   method:'POST',body,operatorToken:secret,fetchImpl:t.fetchImpl});
  assert.equal(valid.status,202);
  assert.equal(t.received.init.headers[header],expected);
 }
});
test('private bridge rejects redirects, HTML and large bodies',async()=>{
 for(const reply of [
  {status:302,headers:new Headers({location:'https://outside.example'}),
   text:async()=>''},
  {status:200,headers:new Headers({'content-type':'text/html'}),
   text:async()=>'<html>bad</html>'},
  {status:200,headers:new Headers({'content-type':'application/json'}),
   text:async()=>JSON.stringify({ok:true,data:'x'.repeat(256001)})}
 ]){
  const result=await requestStreamSeasonBridge({path:NS+'/queue',
   operatorToken:secret,fetchImpl:async()=>reply});
  assert.equal(result.status,503);
 }
});
