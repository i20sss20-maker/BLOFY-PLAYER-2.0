import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessMirrorSourceHeadroom}
 from '../src/xtream-mirror-source-headroom.mjs';

const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const NOW=1700000000000;
function fixture(patch={}){
 const entry={
  id:SOURCE,name:'saleh',enabled:true,status:'online',
  lastTestAt:NOW-30000,providerSnapshotFresh:true,
  sourceReportedMaxConnections:5,sourceReportedActiveConnections:1,
  sourceReportsRestreamer:true,
  activeDirectHttpMediaTransfers:0,directTransferCountsReliable:true,
  ...patch
 };
 return {ok:true,readOnly:true,
  directHttpTransferMeasurementAvailable:true,
  directHttpTransferCountsReliable:true,sources:[entry]};
}
test('fresh cached capacity with two spare connections admits only cautious precheck',()=>{
 const r=assessMirrorSourceHeadroom(fixture(),{sourceId:SOURCE,now:NOW});
 assert.equal(r.ok,true);
 assert.equal(r.code,'mirror_source_headroom_cautiously_clear');
 assert.equal(r.mirrorDownloadAuthorized,false);
 assert.equal(r.allUpstreamSessionsMeasured,false);
 assert.equal(r.sourceMediaRequests,0);
 assert.equal(r.remainingReportedConnections,4);
 assert.equal(r.customerCutover,false);
});
test('a shared source at its upstream limit cannot be used for private copying',()=>{
 for(const x of [
  {sourceReportedMaxConnections:1,sourceReportedActiveConnections:0},
  {sourceReportedMaxConnections:3,sourceReportedActiveConnections:2},
  {sourceReportedMaxConnections:3,sourceReportedActiveConnections:3},
  {sourceReportedMaxConnections:null},
  {sourceReportedActiveConnections:null},
  {activeDirectHttpMediaTransfers:1},
  {directTransferCountsReliable:false},
  {sourceReportsRestreamer:false},
  {sourceReportsRestreamer:null},
  {providerSnapshotFresh:false},
  {lastTestAt:NOW-3600000},
  {status:'offline'},
  {name:'somebody_else'},
  {enabled:false}
 ]){
  const r=assessMirrorSourceHeadroom(fixture(x),{
    sourceId:SOURCE,now:NOW});
  assert.equal(r.ok,false,JSON.stringify(x));
  assert.ok(r.blockedBy.length>0);
  assert.equal(r.writesStarted,false);
  assert.equal(r.sourceMediaRequests,0);
 }
});
test('unreliable process gauge and duplicate source identities fail closed',()=>{
 for(const capacity of [
  {...fixture(),directHttpTransferCountsReliable:false},
  {...fixture(),directHttpTransferMeasurementAvailable:false},
  {...fixture(),sources:[]},
  {...fixture(),sources:[...fixture().sources,...fixture().sources]},
  {},
  null
 ]){
  const out=assessMirrorSourceHeadroom(capacity,{
    sourceId:SOURCE,now:NOW});
  assert.equal(out.ok,false);
  assert.equal(out.mirrorDownloadAuthorized??false,false);
 }
 const invalid=assessMirrorSourceHeadroom(fixture(),{
  sourceId:'bad',now:NOW});
 assert.equal(invalid.ok,false);
 assert.equal(invalid.code,'mirror_source_headroom_input_invalid');
});
test('Portal private Range bridge requires actual cached source-headroom check',async()=>{
 const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.ok(src.includes('assessMirrorSourceHeadroom'));
 assert.ok(src.includes("BLOFY_CONTENT_HUB_MIRROR_SOURCE_HEADROOM_ENABLED!=='1'"));
 assert.ok(src.includes('xtreamDirectMediaGauge.snapshot()'));
 assert.ok(src.includes('summarizeStreamSourceCapacity('));
});
