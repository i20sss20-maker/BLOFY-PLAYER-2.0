import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  classifyXtreamProviderDenial,readXtreamProviderDenialHint,
  validXtreamDenialHint,XTREAM_DENIAL_MESSAGES
} from '../src/xtream-provider-denial.mjs';
import {summarizeSourceMediaProbe,sourceMediaSummary}
  from '../src/xtream-source-media-health.mjs';
import {
  recordXtreamPlayback,xtreamPlaybackSnapshot,resetXtreamPlaybackMetricsForTest
} from '../src/xtream-playback-metrics.mjs';
import {xtreamProbeMessage} from '../src/xtream-series-probe.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('provider-specific errors yield only an allowlisted category',async()=>{
  const cases=[
    ['Your IP is locked to the old ISP','network_restriction'],
    ['This country is blocked','network_restriction'],
    ['Too many connections','connection_limit'],
    ['Your Subscription has expired','account_expired'],
    ['Restream not allowed for this account','restream_not_allowed'],
    ['Output format not supported','output_format_rejected'],
    ['Account disabled','account_inactive']
  ];
  for(const [sample,expected] of cases){
    assert.equal(classifyXtreamProviderDenial(sample),expected);
    assert.ok(XTREAM_DENIAL_MESSAGES[expected]);
    const upstream=new Response(sample+' user=SECRET pass=DO_NOT_LEAK http://example.org/private',{
      status:456,headers:{'content-type':'text/plain'}
    });
    assert.equal(await readXtreamProviderDenialHint(upstream),expected);
  }
  assert.equal(validXtreamDenialHint('unknown_secret'),null);
  assert.equal(classifyXtreamProviderDenial('456 - no information'),null);
  assert.equal(await readXtreamProviderDenialHint(new Response('Your IP is locked',{status:200})),null);
  assert.equal(await readXtreamProviderDenialHint(new Response(null,{status:456})),null);
});

test('only a fixed slug is available to storage, API or monitor, never the raw provider body',()=>{
  const result=summarizeSourceMediaProbe('live',{
    ok:false,checks:[{ok:false,httpStatus:456,providerHint:'network_restriction',
      url:'https://secret.provider/username/password',password:'DO_NOT_LEAK'}]
  },Date.parse('2026-11-06T14:20:00Z'));
  assert.equal(result.providerHint,'network_restriction');
  assert.match(sourceMediaSummary({live:result},Date.parse('2026-11-06T14:20:20Z'))[0].text,/قيد الشبكة/);
  assert.doesNotMatch(JSON.stringify(result),/DO_NOT_LEAK|secret\.provider|password/);
  const msg=xtreamProbeMessage({ok:false,checks:[{httpStatus:456,providerHint:'network_restriction',
    password:'DO_NOT_LEAK'}]},'live');
  assert.match(msg,/HTTP 456/);
  assert.match(msg,/قيد عنوان IP/);
  assert.doesNotMatch(msg,/DO_NOT_LEAK/);
});

test('live media telemetry exposes the hint but drops arbitrary provider-controlled text',()=>{
  resetXtreamPlaybackMetricsForTest();
  recordXtreamPlayback({kind:'live',phase:'failed',itemId:'1217',upstreamStatus:456,
    reason:'upstream_http_456',providerHint:'network_restriction',password:'SECRET'});
  recordXtreamPlayback({kind:'movie',phase:'failed',upstreamStatus:456,
    reason:'upstream_http_456',providerHint:'secret username password http://example.org'});
  const r=xtreamPlaybackSnapshot();
  assert.equal(r.upstreamCodes['456'],2);
  assert.equal(r.recentIssues.find(x=>x.kind==='live').providerHint,'network_restriction');
  assert.ok(!('providerHint' in r.recentIssues.find(x=>x.kind==='movie')));
  assert.doesNotMatch(JSON.stringify(r),/SECRET|example\.org|username/);
  resetXtreamPlaybackMetricsForTest();
});

test('backend probes and gateway never log or return upstream response bodies',async()=>{
  const [admin,gateway,js]=await Promise.all([
    read('src/xtream-admin-hook.mjs'),read('src/xtream-gateway-hook.mjs'),read('web/sources-admin.js')
  ]);
  assert.match(admin,/readXtreamProviderDenialHint\(response\)/);
  assert.match(admin,/providerHint,latencyMs:/);
  assert.match(gateway,/providerHint=retryWithoutRange\|\|shouldRefresh\|\|usingIndependentRelay\?null:/);
  assert.match(gateway,/await readXtreamProviderDenialHint\(response\)/);
  assert.match(gateway,/providerHint,attempts:attempt/);
  assert.match(gateway,/providerHint=await readXtreamProviderDenialHint\(response\)/);
  assert.match(js,/function xtreamProviderHintText/);
  assert.doesNotMatch(js,/result\.rawBody|sample\.rawBody/);
});
