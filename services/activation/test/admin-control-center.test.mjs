import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_CENTER_TARGETS, classifyControlCenterStatus, probeControlCenterTarget,
  controlCenterAsset
} from '../src/admin-control-center.mjs';

test('fixed targets only and HTTPS URLs', () => {
  assert.equal(CONTROL_CENTER_TARGETS.length,4);
  for(const item of CONTROL_CENTER_TARGETS)assert.match(item.endpoint,/^https:\/\//);
});
test('HTTP classification does not mislabel 404 as a healthy stream', () => {
  assert.equal(classifyControlCenterStatus(200),'healthy');
  assert.equal(classifyControlCenterStatus(204),'healthy');
  assert.equal(classifyControlCenterStatus(302),'reachable');
  assert.equal(classifyControlCenterStatus(404),'reachable');
  assert.equal(classifyControlCenterStatus(503),'error');
});
test('probe uses fixed target and returns time without response content', async () => {
  let hit;
  const fetchStub=async (url,opts)=>{
    hit=url;
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'manual');
    return {status:200,body:{cancel:async()=>{}}};
  };
  const result=await probeControlCenterTarget(CONTROL_CENTER_TARGETS[0],fetchStub,()=>100);
  assert.equal(hit,CONTROL_CENTER_TARGETS[0].endpoint);
  assert.equal(result.status,'healthy');
  assert.equal(result.httpStatus,200);
  assert.equal(result.latencyMs,0);
  assert.ok(!('url' in result));
});
test('network failures become offline without showing network error internals', async () => {
  const result=await probeControlCenterTarget(CONTROL_CENTER_TARGETS[0],async()=>{throw new Error('SENSITIVE INFORMATION');});
  assert.equal(result.status,'offline');
  assert.doesNotMatch(JSON.stringify(result),/SENSITIVE INFORMATION/);
});
test('assets are explicit and use no inline JS', async () => {
  const page=(await controlCenterAsset('page')).content.toString('utf8');
  const script=(await controlCenterAsset('js')).content.toString('utf8');
  const style=(await controlCenterAsset('css')).content.toString('utf8');
  assert.match(page,/\/admin\/control-center\/app\.js/);
  assert.match(page,/\/admin\/control-center\/style\.css/);
  assert.doesNotMatch(page,/<script(?:\s|>)(?![^>]*src)/);
  assert.match(script,/api\/v1\/admin\/control-center\/status/);
  assert.ok(style.length>100);
  await assert.rejects(()=>controlCenterAsset('../../etc/passwd'),/unknown_control_center_asset/);
});