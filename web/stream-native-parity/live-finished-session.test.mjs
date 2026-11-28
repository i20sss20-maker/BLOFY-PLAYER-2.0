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
 assert.match(app,/if\(status!==200&&status!==404\)\{ops\.error\(\);return\}/);
});
