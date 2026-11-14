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
  'enqueue','start','pause','confirm','health','audit',
  'concurrent-read','series/31']){
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
  ['health','/internal/seasons/health'],
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

test('manual private storage SHA audit requires exact owner permission and run ID',async()=>{
 const runId='saleh_episode_127434_20261114';
 const audit=stub('/internal/seasons/audit',{status:200,data:{
  ok:true,code:'season_storage_sample_verified',
  sampledOnly:true,checkedParts:3,totalParts:173,checkedBytes:25165824}});
 const body={confirmed:true,runId};
 const bad=await requestStreamSeasonBridge({path:NS+'/audit',
  method:'POST',body:{confirmed:false,runId},
  operatorToken:secret,fetchImpl:audit.fetchImpl});
 assert.equal(bad.status,400);
 assert.equal(audit.calls,0);
 const response=await requestStreamSeasonBridge({path:NS+'/audit',
  method:'POST',body,operatorToken:secret,fetchImpl:audit.fetchImpl});
 assert.equal(response.status,200);
 assert.equal(response.data.sampledOnly,true);
 assert.equal(audit.received.init.headers['x-blofy-season-confirm'],
  'audit-private-verified-chunks');
 assert.equal(audit.received.init.headers['content-type'],'application/json');
 assert.deepEqual(JSON.parse(audit.received.init.body),body);
});

test('two signed verified run IDs are necessary for an explicit concurrent S3 test',async()=>{
 const ids=['saleh_episode_127434_20261114',
   'season_0123456789abcdef01234567'];
 const target=stub('/internal/seasons/concurrent-read',{
  data:{ok:true,concurrentReads:2,playbackVerified:false}});
 const denied=await requestStreamSeasonBridge({
  path:NS+'/concurrent-read',method:'POST',
  body:{confirmed:false,runIds:ids},operatorToken:secret,
  fetchImpl:target.fetchImpl});
 assert.equal(denied.status,400);
 assert.equal(target.calls,0);
 const result=await requestStreamSeasonBridge({
  path:NS+'/concurrent-read',method:'POST',
  body:{confirmed:true,runIds:ids},operatorToken:secret,
  fetchImpl:target.fetchImpl});
 assert.equal(result.status,200);
 assert.equal(result.data.playbackVerified,false);
 assert.equal(target.calls,1);
 assert.equal(target.received.init.headers['x-blofy-season-confirm'],
  'two-verified-private-s3-reads');
 assert.deepEqual(JSON.parse(target.received.init.body),{
  confirmed:true,runIds:ids});
});


test('manual season copy budget forwarded as fixed header, not arbitrary user JSON',async()=>{
 const target=stub('/internal/seasons/start',{status:202,data:{
  ok:true,code:'season_queue_started',maxBatches:12}});
 const base={confirmed:true,sourceIdle:true,licensedStorage:true};
 const denied=await requestStreamSeasonBridge({
  path:NS+'/start',method:'POST',operatorToken:secret,
  body:{...base,maxBatches:2},fetchImpl:target.fetchImpl});
 assert.equal(denied.status,400);
 assert.equal(target.calls,0);
 const good=await requestStreamSeasonBridge({
  path:NS+'/start',method:'POST',operatorToken:secret,
  body:{...base,maxBatches:12},fetchImpl:target.fetchImpl});
 assert.equal(good.status,202);
 assert.equal(target.received.init.headers['x-blofy-season-batch-budget'],'12');
 assert.equal(target.received.init.headers['x-blofy-season-confirm'],
  'start-private-sequential');
});
