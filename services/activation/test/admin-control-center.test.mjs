import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_CENTER_TARGETS, classifyControlCenterStatus, probeControlCenterTarget,
  controlCenterAsset,checkHealthPayload
} from '../src/admin-control-center.mjs';

test('fixed targets only and HTTPS URLs', () => {
  assert.equal(CONTROL_CENTER_TARGETS.length,4);
  assert.ok(CONTROL_CENTER_TARGETS.find(x=>x.id==='decoder')?.endpoint?.includes('blofy-decoder-lab-test.up.railway.app'));
  assert.ok(!CONTROL_CENTER_TARGETS.some(x=>x.endpoint.includes('blofy-control-center-lab')));
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

test('health checker does not mark HTTP 200 with explicit ok:false as healthy',async()=>{
  const response=await probeControlCenterTarget(CONTROL_CENTER_TARGETS[2],
    async()=>new Response(JSON.stringify({ok:false,status:'unhealthy',
      password:'should_never_be_copied'}),{
      status:200,headers:{'content-type':'application/json; charset=utf-8'}
    }));
  assert.equal(response.status,'error');
  assert.equal(response.httpStatus,200);
  assert.ok(!('password' in response));
  assert.doesNotMatch(JSON.stringify(response),/should_never_be_copied/);
});

test('valid JSON health 200 is reachable without exposing response body',async()=>{
  const response=await probeControlCenterTarget(CONTROL_CENTER_TARGETS[0],
    async()=>Response.json({ok:true,details:{secret:'should_not_echo'}}));
  assert.equal(response.status,'healthy');
  assert.doesNotMatch(JSON.stringify(response),/should_not_echo/);
});

test('health JSON is bounded and failure of parsing never treats response as decoded media proof',async()=>{
  const result=await checkHealthPayload(new Response('X'.repeat(6000),{
    status:200,headers:{'content-type':'application/json'}
  }));
  assert.equal(result.isHealthJson,false);
  assert.equal(result.explicitlyUnhealthy,false);
});

test('status page links to actual same-domain STREAM dashboard and its sections',async()=>{
  const html=(await controlCenterAsset('page')).content.toString('utf8');
  assert.match(html,/href="\/admin\/control-center\/health"/);
  assert.match(html,/href="\/admin\/control-center#sources"/);
  assert.match(html,/href="\/admin\/control-center#codes"/);
  assert.match(html,/href="\/admin\/control-center#distributors"/);
  assert.match(html,/href="\/distributor"/);
  assert.doesNotMatch(html,/href="\/stream"/);
  assert.doesNotMatch(html,/href="\/sources-admin#xtream"/);
});
