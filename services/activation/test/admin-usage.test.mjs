import test from 'node:test';
import assert from 'node:assert/strict';
import { readAdminUsage } from '../src/admin-usage.mjs';
import { createExperienceHandlers } from '../src/experience-handlers.mjs';

test('absent download tables stay unavailable instead of inventing zero history',async()=>{
  let calls=0;const value=await readAdminUsage({query:async()=>{calls++;return {rows:[{}]};}});
  assert.equal(value.requests,null);assert.equal(value.completed,null);assert.equal(calls,1);
});
test('legacy request counts never become completed downloads',async()=>{
  const responses=[{requests_table:'blofy_download_stats'},{total:'29',blofy:'19',last_at:null}];
  const data=await readAdminUsage({query:async()=>({rows:[responses.shift()]})});
  assert.equal(data.requests.blofy,19);assert.equal(data.requests.total,29);assert.equal(data.completed,null);
});
test('completed counters preserve start time, Saudi calendar day and genuine zero',async()=>{
  const started='2026-09-21T12:00:00Z';
  const responses=[{completions_table:'present',metadata_table:'present'}, {total:'7',blofy:'5',today:'0',started_at:started,last_at:started}];
  const data=await readAdminUsage({query:async()=>({rows:[responses.shift()]})});
  assert.equal(data.requests,null);assert.deepEqual(data.completed,{total:7,blofy:5,today:0,startedAt:Date.parse(started),lastAt:Date.parse(started),timeZone:'Asia/Riyadh'});
});
test('storage failures are not shown as zero successful downloads',async()=>{
  await assert.rejects(readAdminUsage({query:async()=>{throw Error('database unavailable');}}),/database unavailable/);
});
test('usage endpoint authenticates before querying any metrics',async()=>{
  let queries=0;const handler=createExperienceHandlers({pool:{query:()=>{queries++;throw Error('no access');}},requireAdmin:()=>false,json:()=>{},readJson:()=>{}});
  assert.equal(await handler.handle({method:'GET'},{},new URL('http://test/api/v1/admin/experience/usage')),true);assert.equal(queries,0);
});
