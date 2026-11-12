import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sourceLiveCapacity} from '../src/xtream-live-source-capacity.mjs';
import {summarizeStreamSourceCapacity} from '../src/stream-source-capacity-report.mjs';

const ID='4f03227d-c2ce-427c-a677-85ba1f9b725e';
const ID2='14a92bea-f188-4ebf-80b7-1c617cc32591';
const now=1750000000000;
const source=(details,extra={})=>({
  id:ID,name:'BLOFY legal source',enabled:true,status:'online',
  lastTestAt:now-30000,accountInfo:details,...extra
});

test('provider unknown active/max counts must NEVER be silently coerced into zero',()=>{
  const missing=sourceLiveCapacity({});
  assert.equal(missing.maxConnections,null);
  assert.equal(missing.activeConnections,null);
  assert.ok(missing.warningCodes.includes('source_upstream_limit_unknown'));
  assert.ok(!missing.warningCodes.includes('source_no_upstream_connections'));
  assert.ok(!missing.warningCodes.includes('source_upstream_at_reported_limit'));
  const empty=sourceLiveCapacity({maxConnections:'',activeConnections:null});
  assert.equal(empty.maxConnections,null);
  assert.equal(empty.activeConnections,null);
  assert.equal(sourceLiveCapacity({maxConnections:'0',activeConnections:'0'}).maxConnections,0);
  assert.equal(sourceLiveCapacity({maxConnections:true}).maxConnections,null);
});

test('report separates active gateway subscriptions from provider-reported connection snapshots',()=>{
  const report=summarizeStreamSourceCapacity(
    [source({maxConnections:2,activeConnections:2,isRestreamer:false})],
    [{source_id:ID,total:24,active:19},{source_id:null,total:30,active:7}],
    {now}
  );
  assert.equal(report.ok,true);
  assert.equal(report.actualConcurrentViewersMeasured,false);
  assert.equal(report.redistributionRightsVerified,false);
  assert.equal(report.accountCountsAvailable,true);
  assert.equal(report.unboundActiveGatewayAccounts,7);
  assert.equal(report.sources[0].activeGatewayAccounts,19);
  assert.equal(report.sources[0].sourceReportedMaxConnections,2);
  assert.equal(report.sources[0].sourceReportedActiveConnections,2);
  assert.equal(report.sources[0].level,'restricted');
  assert.equal(report.sources[0].providerSnapshotFresh,true);
  assert.equal(report.sources[0].accountsAreNotConcurrentSessions,true);
  assert.ok(report.sources[0].flags.includes('source_upstream_reported_at_limit'));
  assert.ok(report.sources[0].flags.includes('source_restream_flag_false'));
  assert.equal(report.actionsTaken,0);
});

test('old/stale source account snapshot must not cause false limit alarm',()=>{
  const unknown=summarizeStreamSourceCapacity(
    [source({maxConnections:1,activeConnections:1,isRestreamer:null},
      {lastTestAt:now-86400000})],null,{now}
  );
  assert.equal(unknown.sources[0].level,'unknown');
  assert.equal(unknown.sources[0].providerSnapshotFresh,false);
  assert.equal(unknown.sources[0].activeGatewayAccounts,null);
  assert.equal(unknown.accountCountsAvailable,false);
  assert.equal(unknown.sources[0].flags.includes('source_upstream_reported_at_limit'),false);
  assert.equal(unknown.sources[0].flags.includes('source_capacity_snapshot_stale_or_missing'),true);
  assert.equal(unknown.sources[0].sourceReportedMaxConnections,1);
});

test('source names containing secrets or links are never returned in JSON',()=>{
  const malicious=source({maxConnections:1,activeConnections:0,isRestreamer:true},{
    name:'https://host.example/get.php?username=alice&password=NEVER-EXPOSE',
  });
  const r=summarizeStreamSourceCapacity([malicious],[],{now});
  const serialized=JSON.stringify(r);
  for(const token of ['NEVER-EXPOSE','username','host.example','get.php'])
    assert.ok(!serialized.includes(token),'leaked '+token);
  assert.match(r.sources[0].name,/^المصدر /);
});

test('report deduplicates source IDs and excludes non-UUID source or malformed counts',()=>{
  const response=summarizeStreamSourceCapacity([
    source({maxConnections:1,activeConnections:0}),
    source({maxConnections:1,activeConnections:0}),
    source({maxConnections:5,activeConnections:0},{id:'http://private'}),
    source({maxConnections:null,activeConnections:null},{id:ID2,name:'legal second'})
  ],[
    {source_id:ID,total:100,active:15},{source_id:ID2,total:5,active:3}
  ],{now});
  assert.equal(response.sources.length,2);
  assert.equal(response.sources[1].level,'unknown');
  assert.equal(response.sources[1].activeGatewayAccounts,3);
  assert.equal(response.summary.monitoredSources,2);
  assert.equal(response.truncated,true);
});

test('operator-only aggregate route is behind authenticated fixed bridge, never public player API',async()=>{
  const [hook,safe]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/stream-unified-safe.mjs',import.meta.url),'utf8')
  ]);
  const bridge=hook.slice(hook.indexOf('async function unifiedStreamBridge('),
    hook.indexOf('const previousCreateServer ='));
  assert.match(bridge,/streamBridgeAuthorized\(req\.headers\.authorization,STREAM_BRIDGE_KEY\)/);
  assert.match(bridge,/p==='\/internal\/blofy-stream\/source-capacity'/);
  assert.match(bridge,/SELECT source_id,COUNT\(\*\)::int AS total/);
  assert.doesNotMatch(safe,/sourceReportedMaxConnections/,'safe public catalog cannot expose private capacity');
  assert.equal(bridge.includes('summarizeStreamSourceCapacity('),true);
});
