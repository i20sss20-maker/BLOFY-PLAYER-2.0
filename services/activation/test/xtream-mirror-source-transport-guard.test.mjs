import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMirrorSourceTransportGuard} from '../src/xtream-mirror-source-transport-guard.mjs';
import {assessMirrorSourceHeadroom} from '../src/xtream-mirror-source-headroom.mjs';
const A='123e4567-e89b-42d3-a456-426614174000';
const B='123e4567-e89b-42d3-a456-426614174001';
const time={value:1773650100000};
const make=()=>createMirrorSourceTransportGuard({
 now:()=>time.value,cooldownMs:30*60*1000,maxSources:2
});
function capacity(){
 return {ok:true,readOnly:true,
  directHttpTransferMeasurementAvailable:true,
  directHttpTransferCountsReliable:true,
  sources:[{id:A,name:'saleh',enabled:true,status:'online',
   lastTestAt:time.value-30000,providerSnapshotFresh:true,
   sourceReportedMaxConnections:6,sourceReportedActiveConnections:1,
   sourceReportsRestreamer:true,
   activeDirectHttpMediaTransfers:0,directTransferCountsReliable:true}]};
}
test('a real classified reset blocks just new mirror copies for thirty minutes',()=>{
 time.value=1773650100000;
 const guard=make();
 assert.equal(guard.snapshot({sourceId:A}).ok,true);
 assert.equal(guard.recordFailure({
  sourceId:A,reason:'xtream_transport_connection_reset'}).recorded,true);
 const risk=guard.snapshot({sourceId:A});
 assert.equal(risk.ok,false);
 assert.equal(risk.code,'mirror_transport_cooldown_active');
 assert.equal(risk.remainingMs,30*60*1000);
 assert.equal(guard.snapshot({sourceId:B}).ok,true);
 assert.equal(risk.sourceMediaRequests,0);
 assert.equal(risk.customerCutover,false);
 const summary=assessMirrorSourceHeadroom(capacity(),{
  sourceId:A,now:time.value,transportRisk:risk});
 assert.equal(summary.ok,false);
 assert.ok(summary.blockedBy.includes('mirror_source_recent_transport_failure'));
 time.value+=30*60*1000+1;
 assert.equal(guard.snapshot({sourceId:A}).ok,true);
});
test('untrusted inputs never become raw logs, identifiers or failed-media cooldowns',()=>{
 time.value=1773650100000;
 const guard=make();
 assert.equal(guard.recordFailure({
  sourceId:A,reason:'https://provider/credential?pass=a'}).recorded,false);
 assert.equal(guard.recordFailure({
  sourceId:'invalid',reason:'xtream_transport_connection_reset'}).recorded,false);
 assert.equal(guard.snapshot({sourceId:A}).ok,true);
 const risk=guard.snapshot({sourceId:'invalid'});
 assert.equal(risk.ok,false);
 assert.equal(risk.code,'mirror_transport_risk_unknown');
 const body=JSON.stringify(risk);
 assert.ok(!body.includes('https:'));
 assert.ok(!body.includes('provider'));
 assert.equal(risk.sourceMediaRequests,0);
});
test('max-tracked guard saturation fails closed for all sources',()=>{
 time.value=1773650100000;
 const guard=createMirrorSourceTransportGuard({
  now:()=>time.value,maxSources:1,cooldownMs:60000});
 assert.equal(guard.recordFailure({sourceId:A,reason:'headers_timeout'}).recorded,true);
 assert.equal(guard.recordFailure({sourceId:B,reason:'connection_reset'}).recorded,false);
 assert.equal(guard.snapshot({sourceId:A}).ok,false);
 assert.equal(guard.snapshot({sourceId:B}).code,'mirror_transport_risk_unreliable');
});
test('unknown, corrupt and missing transport reports prevent source copy',()=>{
 time.value=1773650100000;
 for(const risk of [
  {ok:false,code:'mirror_transport_cooldown_active',remainingMs:1},
  {ok:false,code:'mirror_transport_risk_unreliable'},
  {ok:false,code:'mirror_transport_risk_unknown'}
 ]){
  const out=assessMirrorSourceHeadroom(capacity(),{
   sourceId:A,now:time.value,transportRisk:risk});
  assert.equal(out.ok,false);
  assert.equal(out.customerCutover,false);
 }
});
test('mirror gateway observes customer transport failures without changing customer stream code',async()=>{
 const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("mirrorSourceTransportGuard.recordFailure({"));
 assert.ok(source.includes("mirrorSourceTransportGuard.snapshot({sourceId"));
 assert.ok(source.includes("'mirror_source_recent_transport_failure'")||
  (await readFile(new URL('../src/xtream-mirror-source-headroom.mjs',import.meta.url),'utf8'))
   .includes("'mirror_source_recent_transport_failure'"));
});
