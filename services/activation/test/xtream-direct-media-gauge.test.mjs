import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createXtreamDirectMediaGauge} from '../src/xtream-direct-media-gauge.mjs';
import {summarizeStreamSourceCapacity} from '../src/stream-source-capacity-report.mjs';

const source='4f03227d-c2ce-427c-a677-85ba1f9b725e';
const other='14a92bea-f188-4ebf-80b7-1c617cc32591';
const now=1762960000000;

test('actual proxy HTTP transfer gauge tracks live+VOD and returns to zero on idempotent disconnect',()=>{
  let tick=1000;
  const gauge=createXtreamDirectMediaGauge({clock:()=>tick});
  const release1=gauge.begin({kind:'live',sourceId:source});
  const release2=gauge.begin({kind:'live',sourceId:source});
  const release3=gauge.begin({kind:'movie',sourceId:other});
  tick+=6000;
  const active=gauge.snapshot();
  assert.equal(active.activeDirectHttpTransfers,3);
  assert.equal(active.activeDirectLiveHttpTransfers,2);
  assert.equal(active.activeByKind.movie,1);
  assert.equal(active.bySource.find(x=>x.sourceId===source).activeDirectLiveHttpTransfers,2);
  assert.equal(active.longestActiveMs,6000);
  assert.equal(active.countIsUniqueViewers,false);
  assert.equal(active.includesRedirects,false);
  assert.equal(active.includesHlsSegments,false);
  assert.equal(active.includesIndependentEdge,false);
  assert.equal(active.countsReliable,true);
  release1();release1();release2();release3();
  assert.equal(gauge.snapshot().activeDirectHttpTransfers,0);
  assert.equal(gauge.snapshot().transfersClosedSinceBoot,3);
});

test('invalid source, unauthorized requests and invalid kind never enter media gauges',()=>{
  const gauge=createXtreamDirectMediaGauge();
  gauge.begin({kind:'series',sourceId:'https://secret.example/?password=should-not-appear'});
  gauge.begin({kind:'live',sourceId:'invalid'});
  gauge.begin({kind:'shared_grant',sourceId:source});
  const result=gauge.snapshot();
  assert.equal(result.activeDirectHttpTransfers,0);
  assert.doesNotMatch(JSON.stringify(result),/secret|should-not-appear|password/);
});

test('bounded tracking never evicts real active transfers or claims precise counts after saturation',()=>{
  const gauge=createXtreamDirectMediaGauge({maxTracked:1});
  const a=gauge.begin({kind:'live',sourceId:source});
  const b=gauge.begin({kind:'series',sourceId:other});
  const result=gauge.snapshot();
  assert.equal(result.activeDirectHttpTransfers,1);
  assert.equal(result.countsReliable,false);
  assert.equal(result.saturationObserved,true);
  assert.equal(result.transfersStartedSinceBoot,2);
  b();a();a();
  assert.equal(gauge.snapshot().activeDirectHttpTransfers,0);
  assert.equal(gauge.snapshot().countsReliable,false);
  assert.throws(()=>createXtreamDirectMediaGauge({maxTracked:100000}),/direct_transfer_config_invalid/);
});

test('capacity report displays actual DIRECT HTTP connections but never confuses them with unique viewers',()=>{
  const g=createXtreamDirectMediaGauge({clock:()=>now});
  const close1=g.begin({kind:'live',sourceId:source});
  const close2=g.begin({kind:'movie',sourceId:source});
  const report=summarizeStreamSourceCapacity([{
    id:source,name:'legal provider',enabled:true,status:'online',
    lastTestAt:now-10000,accountInfo:{maxConnections:10,activeConnections:2}
  }],[{source_id:source,active:17,total:20}],{
    now,gatewayDirectMedia:g.snapshot()
  });
  assert.equal(report.activeDirectHttpMediaTransfers,2);
  assert.equal(report.activeDirectLiveHttpTransfers,1);
  assert.equal(report.sources[0].activeDirectHttpMediaTransfers,2);
  assert.equal(report.sources[0].activeDirectLiveHttpTransfers,1);
  assert.equal(report.sources[0].activeGatewayAccounts,17);
  assert.equal(report.sources[0].sourceReportedActiveConnections,2);
  assert.equal(report.actualConcurrentViewersMeasured,false);
  assert.match(report.warning,/not simultaneous player streams/);
  assert.match(report.warning,/not redirects\/fanout/);
  close1();close2();
  const recovered=summarizeStreamSourceCapacity([{id:source,enabled:true,status:'online',
    lastTestAt:now-10000,accountInfo:{maxConnections:10}}],[],{
    now,gatewayDirectMedia:g.snapshot()
  });
  assert.equal(recovered.sources[0].activeDirectHttpMediaTransfers,0);
});

test('without direct gateway sampler source report says unknown, never invents zeros',()=>{
  const result=summarizeStreamSourceCapacity([{
    id:source,enabled:true,status:'online',lastTestAt:now-10000,accountInfo:{}
  }],null,{now});
  assert.equal(result.directHttpTransferMeasurementAvailable,false);
  assert.equal(result.activeDirectHttpMediaTransfers,null);
  assert.equal(result.sources[0].activeDirectHttpMediaTransfers,null);
  assert.equal(result.sources[0].directTransferCountsReliable,null);
});

test('real gateway begins counting only after validated media and cleans on all close paths',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const proxy=gateway.slice(gateway.indexOf('async function proxyMedia('),
    gateway.indexOf('// Per-request ACL on every HLS segment/key/variant.'));
  const begin=proxy.indexOf('releaseActiveDirectTransfer=xtreamDirectMediaGauge.begin(');
  const validated=proxy.indexOf('if(!inspection.valid)throw');
  const hls=proxy.indexOf('if(authorizedAccount&&inspection.format');
  assert.ok(begin>validated&&begin>hls);
  assert.match(proxy,/releaseActiveDirectTransfer\(\);\s*if \(!res\.writableEnded\)/);
  assert.match(proxy,/releaseActiveDirectTransfer\(\);\s*req\.off\('aborted',abort\)/);
  assert.ok(proxy.indexOf('if (!account) {')<begin,'must authorize before counting');
  assert.ok(proxy.indexOf('res.writeHead(307')<begin,'redirects cannot count as direct streams');
});
