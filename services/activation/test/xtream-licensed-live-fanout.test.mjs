import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {permittedLicensedLiveFanout,permittedSharedLivePilot} from '../src/xtream-licensed-live-fanout-policy.mjs';
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
test('name-based authorization is limited to uniquely named provider-restreamer sources',()=>{
 const grant={...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS:'',
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh'};
 const candidate={sourceId:source,sourceName:'saleh',
  sourceNameMatches:1,kind:'live',extension:'ts',upstreamRestreamer:true};
 assert.equal(permittedLicensedLiveFanout(candidate,grant),true);
 assert.equal(permittedLicensedLiveFanout({...candidate,sourceName:'SALEH'},grant),true);
 assert.equal(permittedLicensedLiveFanout({...candidate,sourceNameMatches:2},grant),false);
 assert.equal(permittedLicensedLiveFanout({...candidate,sourceNameMatches:null},grant),false);
 assert.equal(permittedLicensedLiveFanout({...candidate,sourceName:'other'},grant),false);
 assert.equal(permittedLicensedLiveFanout({...candidate,upstreamRestreamer:false},grant),false);
 assert.equal(permittedLicensedLiveFanout({...candidate,sourceId:other},grant),true);
 assert.equal(permittedLicensedLiveFanout(candidate,{...grant,
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'*'}),false);
 assert.equal(permittedLicensedLiveFanout(candidate,{...grant,
  BLOFY_STREAM_SHARED_LIVE_CANARY:'0'}),false);
});
test('manual provider approval for saleh works only for one unique named source',()=>{
 const manual={...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS:'',
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1'};
 const row={sourceId:source,sourceName:'saleh',sourceNameMatches:1,
  kind:'live',extension:'ts',upstreamRestreamer:false};
 assert.equal(permittedLicensedLiveFanout(row,manual),true);
 assert.equal(permittedLicensedLiveFanout({...row,upstreamRestreamer:null},manual),true);
 assert.equal(permittedLicensedLiveFanout({...row,sourceNameMatches:2},manual),false);
 assert.equal(permittedLicensedLiveFanout({...row,sourceNameMatches:0},manual),false);
 assert.equal(permittedLicensedLiveFanout({...row,sourceName:'OTHER'},manual),false);
 assert.equal(permittedLicensedLiveFanout({...row,kind:'movie'},manual),false);
 assert.equal(permittedLicensedLiveFanout({...row,extension:'m3u8'},manual),false);
 assert.equal(permittedLicensedLiveFanout(row,{...manual,
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'0'}),false);
 assert.equal(permittedLicensedLiveFanout(row,{...manual,
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'other'}),false);
 assert.equal(permittedLicensedLiveFanout(row,{...manual,
  BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'0'}),false);
 assert.equal(permittedLicensedLiveFanout(row,{...manual,
  BLOFY_STREAM_SHARED_LIVE_CANARY:'0'}),false);
 assert.equal(permittedLicensedLiveFanout(row,{...manual,
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'*'}),false);
 assert.equal(permittedLicensedLiveFanout(row,{...manual,
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS:source,
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'0'}),false);
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
 assert.match(scoped,/permittedSharedLivePilot/);
 assert.doesNotMatch(scoped,/return text\(res,503,'Live distribution temporarily unavailable'/);
 assert.match(gateway,/s\.account_info->>'isRestreamer' = 'true'/);
 assert.match(gateway,/s\.name AS source_name/);
 assert.match(scoped,/sourceName:row\.source_name/);
 assert.match(scoped,/sharedLive:false/);
 assert.equal((scoped.match(/sharedLive:true/g)||[]).length,1);
});

test('shared-live subscriber cutover fails closed without explicit account AND channel pilot',()=>{
 const args={accountId:source,gatewayId:'1312446'};
 const env={BLOFY_STREAM_SHARED_LIVE_PILOT_ENABLED:'1',
  BLOFY_STREAM_SHARED_LIVE_PILOT_ACCOUNT_IDS:source,
  BLOFY_STREAM_SHARED_LIVE_PILOT_CHANNEL_IDS:'1312446'};
 assert.equal(permittedSharedLivePilot(args,env),true);
 assert.equal(permittedSharedLivePilot(args,{...env,BLOFY_STREAM_SHARED_LIVE_PILOT_ENABLED:'0'}),false);
 assert.equal(permittedSharedLivePilot(args,{...env,BLOFY_STREAM_SHARED_LIVE_PILOT_ACCOUNT_IDS:''}),false);
 assert.equal(permittedSharedLivePilot(args,{...env,BLOFY_STREAM_SHARED_LIVE_PILOT_CHANNEL_IDS:''}),false);
 assert.equal(permittedSharedLivePilot({...args,accountId:other},env),false);
 assert.equal(permittedSharedLivePilot({...args,gatewayId:'1312447'},env),false);
 assert.equal(permittedSharedLivePilot(args,{...env,BLOFY_STREAM_SHARED_LIVE_PILOT_ACCOUNT_IDS:'*'}),false);
 assert.equal(permittedSharedLivePilot(args,{...env,BLOFY_STREAM_SHARED_LIVE_PILOT_CHANNEL_IDS:'*'}),false);
});

test('public CDN scope requires an explicitly licensed shared-live ticket',async()=>{
 const sent=[];
 const response={ok:true,path:'/relay/'+'f'.repeat(48),
   expiresInSeconds:45,sharedLiveGranted:true};
 const fakeFetch=async(url,args)=>{
  sent.push(JSON.parse(args.body));
  return new Response(JSON.stringify(response),{
   status:201,headers:{'content-type':'application/json'}});
 };
 const details={sourceUrl:'https://provider.example/live/user/secret/1.ts',
  kind:'live',sharedLive:true,requireSharedLive:true,licensedCdnRedirect:true};
 await issueStreamRelayGrant(details,{env,fetchImpl:fakeFetch});
 assert.equal(sent[0].sharedLive,true);
 assert.equal(sent[0].licensedCdnRedirect,true);
 assert.equal(JSON.stringify(sent[0]).includes('provider.example'),true);
 await issueStreamRelayGrant({...details,requireSharedLive:false},
  {env,fetchImpl:fakeFetch});
 assert.equal(sent[1].licensedCdnRedirect,undefined);
 await issueStreamRelayGrant({...details,sharedLive:false},
  {env,fetchImpl:fakeFetch});
 assert.equal(sent[2].sharedLive,undefined);
 assert.equal(sent[2].licensedCdnRedirect,undefined);
 assert.ok(sent.every(x=>typeof x.sourceUrl==='string'));
});
