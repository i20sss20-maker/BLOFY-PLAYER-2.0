import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictContentRange,probeSalehRangedMovie}
 from '../src/xtream-content-hub-range-pilot.mjs';

const saleh='9adc6472-5d4e-4359-83e4-0298cc038ae3';
function db({sources=1,withMovie=true}={}){
 const queries=[];
 return {queries,query:async(sql,args=[])=>{
  queries.push({sql,args});
  if(sql.includes('FROM blofy_xtream_servers'))
   return {rows:Array.from({length:sources},()=>({id:saleh}))};
  if(sql.includes('SELECT m.gateway_id'))
   return {rows:withMovie?[{gateway_id:32}]:[]};
  throw Error('unexpected query');
 }};
}
function part(from,to,total=123456){
 return {httpStatus:206,transportOk:true,bytesRead:4096,
  contentRange:`bytes ${from}-${to}/${total}`};
}
test('parses only exactly requested Range and safe file size',()=>{
 assert.deepEqual(parseStrictContentRange('bytes 4096-8191/123456',4096,8191),
  {from:4096,to:8191,totalSize:123456});
 for(const bad of ['bytes */123456','bytes 0-4095/*','bytes 4096-8192/123456',
   'bytes 4096-8191/8191','bytes 4096-8191/0','bytes 4096-8191/9999999999999999999999999',
   'bytes 4096-8191/123456\nLocation: evil']){
  assert.equal(parseStrictContentRange(bad,4096,8191),null,bad);
 }
});
test('two RANGE parts are sequential, bounded, same total, no file storage',async()=>{
 const d=db(),calls=[];
 const result=await probeSalehRangedMovie({
  query:d.query,readPart:async request=>{
   calls.push({...request});
   assert.equal(request.sourceId,saleh);
   assert.equal(request.gatewayId,32);
   assert.equal(request.to-request.from+1,4096);
   return part(request.from,request.to);
  }});
 assert.equal(result.ok,true);
 assert.equal(result.sameFileSize,true);
 assert.equal(result.requests,2);
 assert.equal(result.maximumExpectedBodyBytes,8192);
 assert.equal(result.sequentialNotConcurrent,true);
 assert.equal(result.fullDownloadVerified,false);
 assert.equal(result.completeFileCopied,false);
 assert.equal(result.storageRightsVerified,false);
 assert.equal(result.customerTrafficChanged,false);
 assert.deepEqual(calls.map(x=>[x.from,x.to]),[[0,4095],[4096,8191]]);
 assert.ok(d.queries.every(x=>!x.sql.includes('password')));
 assert.equal(result.firstPart.totalSize,123456);
 assert.equal(result.secondPart.totalSize,123456);
 assert.doesNotMatch(JSON.stringify(result),/9adc6472|gatewayId|username|password|\.mkv/);
});
test('unauthorized or missing catalog never makes a source network request',async()=>{
 for(const options of [{sources:0},{sources:2},{withMovie:false}]){
  const d=db(options);let called=0;
  const r=await probeSalehRangedMovie({query:d.query,readPart:async()=>{
   called++;return part(0,4095)
  }});
  assert.equal(r.ok,false);assert.equal(called,0);
  assert.equal(r.requests,0);
 }
});
test('mismatched second chunk or ignored range refuses resume claim',async()=>{
 for(const bad of [
  {httpStatus:200,transportOk:true,bytesRead:4096},
  {httpStatus:206,transportOk:true,bytesRead:4096,contentRange:'bytes 0-4095/120000'},
  {httpStatus:206,transportOk:true,bytesRead:4095,contentRange:'bytes 4096-8191/123456'},
  part(4096,8191,654321)
 ]){
  let n=0;
  const r=await probeSalehRangedMovie({query:db().query,readPart:async()=>{
   n++;return n===1?part(0,4095):bad;
  }});
  assert.equal(r.ok,false);assert.equal(r.completeFileCopied,false);
  assert.equal(r.requests,2);
 }
});
test('request failures never retry a provider GET or expose thrown exception strings',async()=>{
 let reads=0;
 const r=await probeSalehRangedMovie({query:db().query,readPart:async()=>{
   reads++;throw Error('provider-secret=do-not-log');
 }});
 assert.equal(reads,1);
 assert.equal(r.ok,false);
 assert.equal(r.requests,1);
 assert.doesNotMatch(JSON.stringify(r),/provider-secret/);
});
