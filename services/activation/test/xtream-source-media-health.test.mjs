import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeSourceMediaProbe,sourceMediaSummary,sourceAccountWarnings}
  from '../src/xtream-source-media-health.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const now=Date.parse('2026-11-06T04:20:00Z');

test('provider HTTP 456 keeps Xtream API up but marks tested video sample rejected without secrets',()=>{
  const raw={ok:false,checks:[{ok:false,httpStatus:456,
    name:'private movie title',url:'https://host.example/user/password',
    username:'secret',password:'secret'}]};
  const result=summarizeSourceMediaProbe('movie',raw,now);
  assert.deepEqual(result,{checkedAt:'2026-11-06T04:20:00.000Z',
    ok:false,status:'provider-rejected',httpStatus:456,sampled:1,failed:1});
  assert.doesNotMatch(JSON.stringify(result),/secret|private|host|password/);
  const view=sourceMediaSummary({movie:result},now+5000);
  assert.equal(view[0].className,'off');
  assert.match(view[0].text,/456/);
});

test('provider sample checks that succeed are marked media-confirmed without implying entire catalog works',()=>{
  const result=summarizeSourceMediaProbe('episode',{ok:true,
    checks:[{ok:false,httpStatus:404},{ok:false,httpStatus:404},{ok:true,httpStatus:206}]},now);
  assert.equal(result.status,'media-partial');
  assert.equal(result.sampled,3);
  assert.equal(result.failed,2);
  assert.match(sourceMediaSummary({episode:result},now)[0].text,/نجاح جزئي، 2 عينات فاشلة/);
  assert.equal(sourceMediaSummary({episode:result},now)[0].className,'hidden');
  assert.equal(sourceMediaSummary({episode:result},now+24*3600_000+1).length,0);
  assert.equal(sourceMediaSummary({episode:result},now-61_000).length,0);
});

test('source account flags display declared expired, exhausted connections or missing TS capability only',()=>{
  const notices=sourceAccountWarnings({expiresAt:(now-5000)/1000,
    activeConnections:2,maxConnections:2,allowedOutputFormats:['m3u8']},now);
  assert.equal(notices.length,3);
  assert.match(notices.join(' '),/صلاحية/);
  assert.match(notices.join(' '),/2\/2/);
  assert.match(notices.join(' '),/TS/);
  assert.deepEqual(sourceAccountWarnings({expiresAt:0,activeConnections:0,maxConnections:2,
    allowedOutputFormats:['ts','m3u8']},now),[]);
  assert.match(sourceAccountWarnings({isRestreamer:false},now).join(' '),/is_restreamer=0/);
  assert.deepEqual(sourceAccountWarnings({isRestreamer:true},now),[]);
});

test('both operator probe routes save sanitized diagnostics while keeping credentials inaccessible',async()=>{
  const backend=await read('src/xtream-admin-hook.mjs');
  const origin=backend.indexOf('async function persistSourceMediaProbe(');
  const end=backend.indexOf('// Short, explicit playback probe:',origin);
  const probe=backend.slice(origin,end);
  assert.ok(origin>0&&end>origin);
  assert.match(probe,/summarizeSourceMediaProbe/);
  assert.match(probe,/jsonb_build_object/);
  assert.doesNotMatch(probe,/creds\.password|source\.base_url|sourceId/);
  assert.ok((backend.match(/await persistSourceMediaProbe\(id,mediaType,result\)/g)||[]).length===2);
  assert.match(backend,/ADD COLUMN IF NOT EXISTS media_probe_state JSONB/);
  assert.match(backend,/mediaSummary:sourceMediaSummary/);
  assert.match(backend,/mediaWarnings:sourceAccountWarnings/);
  assert.match(backend,/media_probe_state='\{\}'::jsonb/);
});

test('frontend identifies source API online without claiming video is operational',async()=>{
  const js=await read('web/sources-admin.js');
  const css=await read('web/sources-admin.css');
  assert.match(js,/updateSourceMediaIndicators/);
  assert.match(js,/API ONLINE/);
  assert.match(js,/media-health-pill/);
  assert.match(js,/updateSourceAccountWarnings/);
  assert.match(css,/account-health-warning/);
});

test('clean single media sample keeps normal confirmed status and no secret data',()=>{
 const pass=summarizeSourceMediaProbe('movie',{ok:true,checks:[
  {ok:true,httpStatus:206,title:'private movie',password:'not-for-clients'}
 ]},now);
 assert.equal(pass.status,'media-confirmed');
 assert.equal(pass.failed,0);
 assert.equal(sourceMediaSummary({movie:pass},now)[0].className,'on');
 assert.doesNotMatch(JSON.stringify(pass),/private movie|not-for-clients/);
});
test('provider failures cannot be masked by a success in the same source probe',()=>{
 const mixed=summarizeSourceMediaProbe('live',{ok:true,checks:[
   {ok:false,httpStatus:404,sourceUrl:'https://secret.example/u/p/99.ts'},
   {ok:true,httpStatus:200}
 ]},now);
 assert.equal(mixed.status,'media-partial');
 assert.equal(mixed.failed,1);
 const chip=sourceMediaSummary({live:mixed},now)[0];
 assert.equal(chip.className,'hidden');
 assert.match(chip.text,/نجاح جزئي/);
 assert.doesNotMatch(JSON.stringify(mixed),/secret\.example|\/u\/p\//);
});
