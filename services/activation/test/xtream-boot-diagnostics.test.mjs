import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runXtreamBootDiagnostics} from '../src/xtream-boot-diagnostics.mjs';

const make=(i)=>({id:`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`,enabled:true,base_url:'https://private.example',username_secret:'SECRET',password_secret:'SECRET'});

test('real provider checks are limited to four and run serially',async()=>{
 const events=[],reports=[];
 const rows=Array.from({length:8},(_,i)=>make(i+1));
 const result=await runXtreamBootDiagnostics({rows,probe:async(row)=>{
   events.push(row.id);return {code:'xtream_api_reachable'};
 },log:x=>reports.push(x),wait:async()=>{}});
 assert.equal(result.length,4);
 assert.equal(events.length,4);
 assert.deepEqual(reports.map(x=>x.code),Array(4).fill('xtream_api_reachable'));
});
test('disabled sources never trigger provider calls',async()=>{
 const rows=[{...make(1),enabled:false},make(2)];
 let calls=0;
 const out=await runXtreamBootDiagnostics({rows,probe:async()=>{calls++;return {code:'xtream_transport_connection_reset'}},log:()=>{}});
 assert.equal(calls,1);assert.equal(out.length,1);
});
test('provider secrets and unknown messages never leave diagnostic results',async()=>{
 const rows=[make(1)];
 let logged;
 const output=await runXtreamBootDiagnostics({rows,
  probe:async()=>({code:'xtream_error_https://user:password@private.example/playlist',username:'user',password:'password'}),
  log:x=>{logged=x}
 });
 const data=JSON.stringify({logged,output});
 assert.equal(logged.code,'xtream_connection_unknown');
 assert.doesNotMatch(data,/password|private\.example|username_secret|playlist/);
 assert.equal(logged.playbackVerified,false);
});
test('failing one source does not prevent the rest',async()=>{
 const rows=[make(1),make(2)];const messages=[];
 const result=await runXtreamBootDiagnostics({rows,
  probe:async row=>{if(row.id===rows[0].id)throw Error('private secret');return {code:'xtream_transport_connection_reset'}},
  log:x=>messages.push(x)
 });
 assert.deepEqual(result.map(x=>x.code),['xtream_connection_unknown','xtream_transport_connection_reset']);
 assert.equal(messages.length,2);
});
test('diagnostic is opt-in and never writes, syncs or serves content',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const snippet=c.slice(c.indexOf("if(process.env.BLOFY_XTREAM_ONE_SHOT_DIAGNOSTIC==='1')"),c.indexOf('async function testServer(id)'));
 assert.match(snippet,/runXtreamBootDiagnostics/);
 assert.match(snippet,/fetchAccount\(row,\{timeoutMs:8000,maxAttempts:1\}\)/);
 assert.match(snippet,/BLOFY_XTREAM_DIAGNOSTIC_END/);
 assert.doesNotMatch(snippet,/UPDATE |DELETE |INSERT |syncServer|probeXtreamPlayback|\.password_secret|\.username_secret/);
});

test('media release smoke is opt-in, limits to one reachable source and never changes customer streams',async()=>{
 const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=source.indexOf("if(process.env.BLOFY_XTREAM_ONE_SHOT_MEDIA_PROBE==='1')");
 const end=source.indexOf('async function testServer(id)',start);
 assert.ok(start>=0&&end>start);
 const segment=source.slice(start,end);
 assert.match(segment,/fetchAccount\(row,\{timeoutMs:8000,maxAttempts:1\}\)/);
 assert.match(segment,/if\(!reachable\)continue/);
 assert.match(segment,/for\(const row of sources\.slice\(0,4\)\)/);
 assert.match(segment,/break; \/\/ Exactly one provider/);
 assert.match(segment,/probeXtreamPlayback\(row\.id,mediaType\)/);
 assert.match(segment,/pictureAndSoundVerified:false/);
 assert.doesNotMatch(segment,/persistSourceMediaProbe|syncServer\(|UPDATE |DELETE |INSERT |response\.body|username_secret|password_secret/);
 assert.match(segment,/BLOFY_REAL_MEDIA_SAMPLE_END/);
});
