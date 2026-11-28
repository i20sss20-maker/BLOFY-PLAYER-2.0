import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const a=app.indexOf('function liveHlsFailureReason('),b=app.indexOf('function resumeLiveHlsNetwork(',a);
assert.ok(a>=0&&b>a,'run release transform before testing');
const lost=new Function(app.slice(a,b)+';return liveSessionLost')();
const detail=(reason,fatal=false)=>({fatal,networkDetails:{getResponseHeader:()=>reason}});
test('explicit retired producer renews session even before initial manifest or fatal escalation',()=>{
 for(const reason of ['hls_source_finished','hls_session_closed','hls_source_stalled']){
  for(const record of [{},{manifestParsed:true}]){
   assert.equal(lost(record,detail(reason),503),true);
   assert.equal(lost(record,detail(reason,true),503),true);
   assert.equal(lost(record,detail(reason),401),false);
  }
 }
 for(const reason of ['hls_capacity','hls_origin_backoff','live_source_channel_limit','other',null]){
  assert.equal(lost({},detail(reason,true),503),false);
  assert.equal(lost({manifestParsed:true},detail(reason),503),false);
 }
 assert.equal(lost({manifestParsed:true},{...detail('hls_origin_backoff',true),details:'levelLoadError'},503),false);
});
test('released app reuses deferred recovery, stop acknowledgement and initial manifest reload',()=>{
 assert.match(app,/if\(!detail\.fatal&&!liveSessionLost\(record,detail,code\)\)return/);
 assert.match(app,/deferHlsRetry\('originTimer',delay,function\(\)\{/);
 assert.match(app,/if\(!record\.manifestParsed\)engine\.loadSource\(manifest\)/);
 const start=app.indexOf('function queueLiveHlsHandoff('),end=app.indexOf('function liveHlsFailureReason(',start);
 const queue=new Function(app.slice(start,end)+';return queueLiveHlsHandoff')();
 const state={},calls=[];let ack;
 const ops={detach(){calls.push('detach')},current:()=>true,visible:()=>true,matches:()=>true,
  wait(){},error(){calls.push('error')},timer:()=>1,clear(){},
  stop(key,cb){calls.push(key);ack=cb},start(req){calls.push(req.id)}};
 queue(state,{id:'9'},'old-sid',ops);
 assert.deepEqual(calls,['detach','old-sid']);
 ack(503);assert.deepEqual(calls,['detach','old-sid','error']);
 queue(state,{id:'9'},null,ops);
 assert.equal(calls.at(-1),'old-sid');
 ack(200);assert.equal(calls.at(-1),'9');
 assert.equal(state.liveHlsHandoff,null);
});
