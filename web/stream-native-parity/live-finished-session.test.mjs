import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const a=app.indexOf('function liveFinishedHlsHint('),b=app.indexOf('function playHls(',a);
assert.ok(a>=0&&b>a);
const hint=new Function(app.slice(a,b)+';return liveFinishedHlsHint')();
test('finished live worker triggers fresh session recovery, respecting bounded retry hints',()=>{
 const detail=(reason,retry)=>({networkDetails:{getResponseHeader:name=>name==='Retry-After'?retry:reason}});
 for(const reason of ['hls_source_finished','hls_session_closed','hls_source_stalled']){
  assert.deepEqual(hint(detail(reason,'5'),503),{ended:true,delay:5000});
  assert.equal(hint(detail(reason,'5'),401).ended,false);
 }
 assert.equal(hint(detail('hls_capacity','5'),503).ended,false);
 assert.equal(hint(detail('hls_origin_backoff','5'),503).ended,false);
 for(const value of ['999','-1','1.5',null])assert.equal(hint(detail('hls_source_finished',value),503).delay,2000);
 assert.deepEqual(hint({networkDetails:{headers:new Headers({'X-Blofy-Hls-Reason':'hls_source_finished','Retry-After':'12'})}},503),{ended:true,delay:12000});
});
test('retired worker recovery cancels obsolete callbacks and keeps acknowledged handoff',()=>{
 assert.match(app,/if\(old\.finishedSessionTimer\)clearTimeout\(old\.finishedSessionTimer\)/);
 assert.match(app,/record\.reconnecting\|\|record\.finishedSessionTimer/);
 assert.match(app,/record\.finishedSessionTimer=setTimeout\(renewFinished,hint\.delay\)/);
 assert.match(app,/if\(record\.manifestParsed\)engine\.startLoad\(\);else engine\.loadSource\(manifest\)/);
 assert.match(app,/if\(status!==200&&status!==404\)\{ops\.error\(\);return\}/);
});
