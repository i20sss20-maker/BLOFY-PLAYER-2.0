import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authorizedMediaRecoveryRelease} from '../src/xtream-media-recovery-release.mjs';
import {safeLiveTsRecoveryStart} from '../src/xtream-live-ts-recovery.mjs';
import {verifiedVodResumePlan} from '../src/xtream-vod-range-resume.mjs';

const account='937ba740-b1dd-44cf-9ff4-55b99e4ca15a';
const source='f2631a8b-37e4-4b37-ab7b-3f3fe2de912f';
const base={enabled:true,accountId:account,sourceId:source,serverEnabled:true,kind:'live',method:'GET'};

test('real production release only for an authenticated and enabled source with a valid account',()=>{
 assert.equal(authorizedMediaRecoveryRelease(base),true);
 for(const input of [{enabled:false},{accountId:'guest'},{accountId:''},
  {sourceId:'*'},{sourceId:''},{serverEnabled:false},
  {kind:'other'},{method:'HEAD'}]){
  assert.equal(authorizedMediaRecoveryRelease({...base,...input}),false,JSON.stringify(input));
 }
 assert.equal(authorizedMediaRecoveryRelease({...base,kind:'movie'}),true);
 assert.equal(authorizedMediaRecoveryRelease({...base,kind:'series'}),true);
});
test('production boolean cannot bypass direct verified MP4 or open-ended TS media contract',()=>{
 const release=authorizedMediaRecoveryRelease(base);
 const ts=new Uint8Array(564);ts[0]=ts[188]=ts[376]=0x47;
 const live=new Response(new ReadableStream({start(controller){controller.enqueue(ts)}}),{
  status:200,headers:{'content-type':'video/mp2t'}
 });
 assert.equal(safeLiveTsRecoveryStart({
  enabled:release,kind:'live',method:'GET',status:200,format:'ts',
  response:live,first:ts
 }),true);
 assert.equal(safeLiveTsRecoveryStart({
  enabled:release,kind:'live',method:'GET',status:200,format:'ts',
  usingIndependentRelay:true,response:live,first:ts
 }),false);
 const headers=new Headers({'content-length':'8192','accept-ranges':'bytes',
  'etag':'"stable-media-file"','content-type':'video/mp4'});
 assert.equal(verifiedVodResumePlan({
  enabled:release,kind:'movie',method:'GET',status:200,format:'mp4',headers
 })?.total,8192);
 assert.equal(verifiedVodResumePlan({
  enabled:release,kind:'movie',method:'GET',status:200,format:'mp4',
  usingIndependentRelay:true,headers
 }),null);
});
test('gateway requires independent explicit production switches, never implicitly on',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(gateway,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PRODUCTION==='1'/);
 assert.match(gateway,/BLOFY_XTREAM_VOD_RANGE_RESUME_PRODUCTION==='1'/);
 const liveBlock=gateway.slice(gateway.indexOf('const liveTsPilot=safeLiveTsRecoveryStart('),
  gateway.indexOf('let resumedVod=false;'));
 assert.match(liveBlock,/serverEnabled:row.server_enabled===true,method:req.method,kind/);
 const vodBlock=gateway.slice(gateway.indexOf('const vodPlan=verifiedVodResumePlan('),
  gateway.indexOf('if\(vodPlan&&first.value.byteLength>vodPlan.total\)'));
 assert.match(vodBlock,/serverEnabled:row.server_enabled===true,method:req.method,kind/);
});
