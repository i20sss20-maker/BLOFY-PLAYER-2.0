import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { XtreamDenialCooldown } from '../src/xtream-denial-cooldown.mjs';
import { recordXtreamPlayback,xtreamPlaybackSnapshot,resetXtreamPlaybackMetricsForTest } from '../src/xtream-playback-metrics.mjs';

test('only repeated provider refusals for the identical channel trigger cooldown',()=>{
  const c=new XtreamDenialCooldown({windowMs:60_000,cooldownMs:45_000,threshold:2});
  const key='safe-source:live:101';
  assert.equal(c.denied(key,456,1000),false);
  assert.equal(c.active(key,2000),null);
  assert.equal(c.denied('safe-source:live:102',456,2000),false);
  assert.equal(c.denied(key,456,3000),true);
  assert.deepEqual(c.active(key,4000),{status:456,retryAfterSeconds:44});
  assert.equal(c.active('safe-source:live:102',4000),null);
  assert.equal(c.active('other-source:live:101',4000),null);
  assert.equal(c.active(key,48000),null);
  assert.equal(c.denied(key,456,49000),false);
  c.clear(key);
  assert.equal(c.active(key,49001),null);
});

test('non-denial errors never trigger the cooldown',()=>{
  const c=new XtreamDenialCooldown({threshold:2});
  for(const status of [200,206,404,408,416,429,500,502,503])
    assert.equal(c.denied('movie:7',status,1000),false);
  assert.equal(c.active('movie:7',1500),null);
  assert.equal(c.denied('movie:7',403,2000),false);
  assert.equal(c.denied('movie:7',456,2400),false);
  assert.equal(c.active('movie:7',2600),null);
  assert.equal(c.denied('movie:7',456,2800),true);
  assert.equal(c.active('movie:7',3200)?.status,456);
});

test('deny memory is bounded and expires without persistent blocks',()=>{
  const c=new XtreamDenialCooldown({maxEntries:2,windowMs:1000,cooldownMs:500,threshold:2});
  c.denied('a',403,1000);c.denied('b',403,1000);c.denied('c',403,1000);
  assert.equal(c.size,2);
  assert.equal(c.denied('a',403,1100),false);
  c.denied('a',403,1200);
  assert.equal(c.active('a',1250)?.status,403);
  assert.equal(c.active('a',1800),null);
});

test('denial cooldown is auditable without exposing source credentials',()=>{
  resetXtreamPlaybackMetricsForTest();
  recordXtreamPlayback({kind:'live',phase:'failed',itemId:108,
    upstreamStatus:456,reason:'upstream_denial_cooldown'});
  const report=xtreamPlaybackSnapshot();
  assert.equal(report.upstreamCodes['456'],1);
  assert.equal(report.recentIssues[0].reason,'upstream_denial_cooldown');
  assert.equal(report.recentIssues[0].itemId,108);
  resetXtreamPlaybackMetricsForTest();
});

test('gateway integrates cooldown only after a real upstream denial',async()=>{
  const gw=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(gw,/mediaDenialCooldown\.active\(cooldownKey\)/);
  assert.match(gw,/mediaDenialCooldown\.denied\(cooldownKey,response\.status\)/);
  assert.match(gw,/mediaDenialCooldown\.clear\(cooldownKey\)/);
  assert.match(gw,/retry-after/);
  assert.match(ui,/upstream_denial_cooldown/);
  assert.match(ui,/publishCatalog:false/);
  assert.match(ui,/window\.confirm\('المصدر/);
});
