import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeXtreamLiveStability}
 from '../src/xtream-live-stability-summary.mjs';
test('source EOF and provider limit are visible without a customer identifier',()=>{
 const report=summarizeXtreamLiveStability({
  byKind:{live:{started:8,failed:0,interrupted:1,clientClosed:2}},
  liveTsSourceDrops:3,liveTsRecoverySuccesses:2,shortLiveUpstreamEnds:1,
  upstreamCodes:{429:2}
 },{maxConnections:1,activeConnections:1,isRestreamer:false});
 assert.equal(report.status,'instability_observed');
 assert.ok(report.findings.includes('provider_limit'));
 assert.ok(report.findings.includes('provider_denials'));
 assert.ok(report.findings.includes('source_drops'));
 assert.ok(report.findings.includes('provider_restream_not_confirmed'));
 assert.equal(report.metrics.liveTsRecoverySuccesses,2);
 assert.doesNotMatch(JSON.stringify(report),/password|username|streamId|token/i);
});
test('quiet instance cannot claim global stability',()=>{
 const result=summarizeXtreamLiveStability();
 assert.equal(result.status,'insufficient_sample');
 assert.deepEqual(result.findings,['insufficient_samples']);
});
