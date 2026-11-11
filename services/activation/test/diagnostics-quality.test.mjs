import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qualitySample, qualityHours, publicQualitySummary} from '../src/diagnostics-quality.mjs';

test('accepts only bounded non-identifying QoE counters',()=>{
  assert.deepEqual(qualitySample({rebufferCount:2,rebufferMs:4500,recoveryCount:1}),{
    rebufferCount:2,rebufferMs:4500,recoveryCount:1
  });
  assert.deepEqual(qualitySample({rebufferCount:-5,rebufferMs:Infinity,recoveryCount:'username=secret'}),{
    rebufferCount:0,rebufferMs:0,recoveryCount:0
  });
  assert.deepEqual(qualitySample({rebufferCount:'999999999999',rebufferMs:'999999999999',recoveryCount:'999999999999'}),{
    rebufferCount:1000,rebufferMs:3600000,recoveryCount:1000
  });
  assert.deepEqual(qualitySample({}),{rebufferCount:0,rebufferMs:0,recoveryCount:0});
});
test('hours limited to 1–168; invalid query defaults to 24 hours',()=>{
  assert.equal(qualityHours('24'),24);
  assert.equal(qualityHours('168'),168);
  for(const x of ['999999','abc','-1','0',null,undefined])assert.equal(qualityHours(x),24);
});
test('summary removes unknown fields and does not expose device or source secrets',()=>{
  const result=publicQualitySummary([{
    content_kind:'live',observations:'10',starts:'9',p50_ms:'450',
    p90_ms:'2450',errors:'2',rebuffer_count:'4',rebuffer_ms:'21000',
    recovery_count:'3',device_id:'BLOFY-SECRET',provider_key:'SECRET',
    redacted_url:'https://user:password@server.test/live/u/p/id.ts'
  }]);
  assert.deepEqual(result,[{
    kind:'live',observations:10,starts:9,medianFirstFrameMs:450,
    p90FirstFrameMs:2450,errors:2,rebufferCount:4,rebufferMs:21000,
    recoveryCount:3
  }]);
  const encoded=JSON.stringify(result);
  assert.doesNotMatch(encoded,/SECRET|password|server\.test|device_id/);
});
test('schema migration is additive for existing installations',async()=>{
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  for(const column of ['rebuffer_count','rebuffer_ms','recovery_count'])
    assert.match(schema,new RegExp('ALTER TABLE playback_diagnostics ADD COLUMN IF NOT EXISTS '+column));
  assert.match(schema,/idx_playback_diag_created/);
});
test('aggregate route is admin gated and does not expose device IDs in aggregate response',async()=>{
  const server=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(server,/async function adminQualitySummary\(req, res, requestUrl\)\s*\{\s*if \(!requireAdmin\(req, res\)\) return;/);
  assert.match(server,/pathname === '\/api\/v1\/admin\/diagnostics\/quality'/);
  assert.match(server,/note:'opt_in_device_samples_not_provider_availability'/);
  assert.match(server,/publicQualitySummary\(result\.rows\)/);
  const page=await readFile(new URL('../web/admin.html',import.meta.url),'utf8');
  assert.match(page,/id="stream-qoe-summary"/);
  assert.match(page,/admin-stream-quality\.js/);
});
