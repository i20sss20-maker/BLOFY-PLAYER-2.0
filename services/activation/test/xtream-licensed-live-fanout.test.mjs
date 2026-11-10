import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {permittedLicensedLiveFanout} from '../src/xtream-licensed-live-fanout-policy.mjs';
import {issueStreamRelayGrant} from '../src/xtream-stream-relay-bridge.mjs';
const source='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const env={
 BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS:source,
 BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'1',
 BLOFY_STREAM_SHARED_LIVE_CANARY:'1',
 BLOFY_STREAM_RELAY_ORIGIN:'https://blofy-stream-api-production.up.railway.app',
 BLOFY_STREAM_RELAY_SHARED_TOKEN:'secret_abcdefghijklmnopqrstuvwxyz123456789'
};
test('fanout requires provider restreamer authorization AND explicit source rights, never code count',()=>{
 const args={sourceId:source,kind:'live',extension:'ts',upstreamRestreamer:true};
 assert.equal(permittedLicensedLiveFanout(args,env),true);
 assert.equal(permittedLicensedLiveFanout({...args,upstreamRestreamer:false},env),false);
 assert.equal(permittedLicensedLiveFanout({...args,upstreamRestreamer:null},env),false);
 assert.equal(permittedLicensedLiveFanout({...args,sourceId:other},env),false);
 assert.equal(permittedLicensedLiveFanout({...args,kind:'movie'},env),false);
 assert.equal(permittedLicensedLiveFanout({...args,extension:'m3u8'},env),false);
 assert.equal(permittedLicensedLiveFanout(args,{...env,BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'0'}),false);
 assert.equal(permittedLicensedLiveFanout(args,{...env,BLOFY_STREAM_SHARED_LIVE_CANARY:'0'}),false);
 assert.equal(permittedLicensedLiveFanout(args,{...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS:''}),false);
 assert.equal(permittedLicensedLiveFanout(args,{...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS:'*'}),false);
});
test('licensing gateway requires confirmed shared ticket or fails before customer redirect',async()=>{
 const base={sourceUrl:'https://provider.example/live/user/credential/3.ts',
  kind:'live',sharedLive:true,requireSharedLive:true};
 let requestPayload=null;
 const fakeFetch=async(url,args)=>{
  assert.ok(url.endsWith('/internal/relay-grants'));
  requestPayload=JSON.parse(args.body);
  return new Response(JSON.stringify({ok:true,path:'/relay/'+'a'.repeat(48),
   expiresInSeconds:45,sharedLiveGranted:false}),{
    status:201,headers:{'content-type':'application/json'}});
 };
 await assert.rejects(issueStreamRelayGrant(base,{env,fetchImpl:fakeFetch}),
  /stream_shared_live_not_granted/);
 assert.equal(requestPayload.sharedLive,true);
 const successFetch=async()=>new Response(JSON.stringify({ok:true,
  path:'/relay/'+'b'.repeat(48),expiresInSeconds:45,sharedLiveGranted:true}),{
  status:201,headers:{'content-type':'application/json'}});
 const result=await issueStreamRelayGrant(base,{env,fetchImpl:successFetch});
 assert.match(result,/^https:\/\/blofy-stream-api-production\.up\.railway\.app\/relay\/[0-9a-f]{48}$/);
});
test('source ACL is checked before redirect and shared fanout failures never spawn per-viewer origin GETs',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=gateway.indexOf('async function proxyMedia(');
 const scoped=gateway.slice(start,gateway.indexOf('async function probeGatewayMedia(',start));
 const acl=scoped.indexOf("if (!row || !row.server_enabled)");
 const upstream=scoped.indexOf('const upstream = mediaUpstreamUrl(');
 const fanout=scoped.indexOf('permittedLicensedLiveFanout(');
 const next=scoped.indexOf('// Optional one-account canary:');
 assert.ok(acl>=0&&acl<upstream&&upstream<fanout&&fanout<next);
 assert.match(scoped,/requireSharedLive:true/);
 assert.match(scoped,/source_restreamer_allowed===true/);
 assert.match(scoped,/return text\(res,503,'Live distribution temporarily unavailable'/);
 assert.match(gateway,/s\.account_info->>'isRestreamer' = 'true'/);
});
