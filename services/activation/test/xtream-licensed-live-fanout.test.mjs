import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {permittedLicensedLiveFanout,permittedSharedLivePilot,
  createFirstAccountSharedLiveTestPilot,authorizedLiveTrialQuota} from '../src/xtream-licensed-live-fanout-policy.mjs';
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
 await issueStreamRelayGrant({...details,sharedLive:false,requireSharedLive:false},
  {env,fetchImpl:fakeFetch});
 assert.equal(sent[2].sharedLive,undefined);
 assert.equal(sent[2].licensedCdnRedirect,undefined);
 assert.ok(sent.every(x=>typeof x.sourceUrl==='string'));
});


test('owner trial is off by default and selects only the first verified account on saleh',()=>{
 const owner=createFirstAccountSharedLiveTestPilot();
 const accountA=source,accountB=other,channel='123456';
 const cfg={BLOFY_STREAM_SHARED_LIVE_FIRST_ACCOUNT_TEST_ENABLED:'1',
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh'};
 const A={accountId:accountA,gatewayId:channel,sourceName:'saleh'};
 assert.equal(owner(A,{}),false);
 assert.equal(owner({...A,sourceName:'other'},cfg),false);
 assert.equal(owner({...A,accountId:'*'},cfg),false);
 assert.equal(owner({...A,gatewayId:'*'},cfg),false);
 assert.equal(owner(A,cfg),true);
 assert.equal(owner({...A,accountId:accountB},cfg),false);
 assert.equal(owner({...A,gatewayId:'123457'},cfg),true);
 assert.equal(owner(A,{...cfg,BLOFY_STREAM_SHARED_LIVE_FIRST_ACCOUNT_TEST_ENABLED:'0'}),false);
 assert.equal(owner({...A,sourceName:'sAleH'},cfg),true);
 assert.equal(owner(A,{...cfg,BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'other'}),false);
});
test('gateway authorizes licensed source before claiming single-account owner slot',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const begin=gateway.indexOf('async function proxyMedia(');
 const scoped=gateway.slice(begin,gateway.indexOf('// Optional one-account canary:',begin));
 assert.ok(scoped.indexOf('permittedLicensedLiveFanout({')>=0);
 assert.ok(scoped.indexOf('permittedLicensedLiveFanout({')<
   scoped.indexOf('firstAccountSharedLiveTestPilot({'));
 assert.match(scoped,/accountId:account\.id,gatewayId,sourceName:row\.source_name/);
 assert.match(scoped,/licensedCdnRedirect:true/);
});

test('explicit two-code pilot shares saleh for exactly two authenticated accounts',()=>{
 const guard=createFirstAccountSharedLiveTestPilot();
 const third='33333333-3333-4333-8333-333333333333';
 const cfg={BLOFY_STREAM_SHARED_LIVE_FIRST_ACCOUNT_TEST_ENABLED:'1',
  BLOFY_STREAM_SHARED_LIVE_TWO_ACCOUNT_TEST_ENABLED:'1',
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh'};
 const check=(accountId,sourceName='saleh',gatewayId='1312445')=>
  guard({accountId,sourceName,gatewayId},cfg);
 assert.equal(check(source),true);
 assert.equal(check(other),true);
 assert.equal(check(source),true);
 assert.equal(check(other,'saleh','1312446'),true);
 assert.equal(check(third),false,'third account must use previous playback path');
 assert.equal(check(source,'another-source'),false);
 assert.equal(check(third,'saleh','*'),false);
 assert.equal(check(third),false);
});
test('two-code mode cannot enable without first-account operator gate',()=>{
 const guard=createFirstAccountSharedLiveTestPilot();
 const cfg={BLOFY_STREAM_SHARED_LIVE_FIRST_ACCOUNT_TEST_ENABLED:'0',
  BLOFY_STREAM_SHARED_LIVE_TWO_ACCOUNT_TEST_ENABLED:'1',
  BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh'};
 assert.equal(guard({accountId:source,gatewayId:'1312446',sourceName:'saleh'},cfg),false);
});

test('shared live uses same-origin response for bearer and Xtream clients, with no direct fallback',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=gateway.indexOf('async function proxyMedia(');
 const scope=gateway.slice(start,gateway.indexOf('// Optional one-account canary:',start));
 assert.match(scope,/return await proxySharedLiveTicket\(req,res,destination,observe\)/);
 assert.doesNotMatch(scope,/writeHead\(307/);
 assert.match(scope,/return text\(res,503,'Shared live relay unavailable'/);
 const fn=gateway.slice(gateway.indexOf('async function proxySharedLiveTicket('),start);
 const calls=[];
 const run=new Function('fetch','text','pipeline','Readable',fn+'\nreturn proxySharedLiveTicket;')(
   async(url,opts)=>{calls.push({url:String(url),opts});return new Response('busy',{status:429})},
   (res,status,body,ct,headers)=>{res.status=status;res.retry=headers?.['retry-after']},
   async()=>{throw Error('unexpected pipeline')},{fromWeb:x=>x});
 const req={once(){},off(){},aborted:false};
 const res={once(){},off(){},destroyed:false,headersSent:false};
 await run(req,res,'https://example.invalid/relay/'+'a'.repeat(48),()=>{});
 assert.equal(calls.length,0);assert.equal(res.status,503);
 await run(req,res,'https://blofy-stream-api-production.up.railway.app/relay/'+'a'.repeat(48),()=>{});
 assert.equal(calls.length,1);assert.equal(res.status,429);assert.equal(res.retry,'5');
 assert.equal(calls[0].opts.redirect,'manual');
 assert.equal(calls[0].opts.headers.authorization,undefined);
});

test('production shared admission requires explicit operator opt-in and known provider limit',async()=>{
 const {permittedLicensedLiveProduction}=await import('../src/xtream-licensed-live-fanout-policy.mjs');
 const env={BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1'};
 assert.equal(permittedLicensedLiveProduction({providerMaxConcurrentFeeds:1},env),true);
 assert.equal(permittedLicensedLiveProduction({providerMaxConcurrentFeeds:4},env),true);
 for(const v of [null,0,-1,65,'4',1.5])assert.equal(permittedLicensedLiveProduction({providerMaxConcurrentFeeds:v},env),false);
 assert.equal(permittedLicensedLiveProduction({providerMaxConcurrentFeeds:4},{}),false);
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const scope=gateway.slice(gateway.indexOf('async function proxyMedia('),gateway.indexOf('// Optional one-account canary:'));
 assert.ok(scope.indexOf('permittedLicensedLiveFanout({')<scope.indexOf('permittedLicensedLiveProduction({'));
});

test('shared source channel limit preserves retry hint and returns only a fixed safe status',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const fn=gateway.slice(gateway.indexOf('async function proxySharedLiveTicket('),gateway.indexOf('async function proxyMedia('));
 let reason,headers;
 const run=new Function('fetch','text','pipeline','Readable',fn+'\nreturn proxySharedLiveTicket;')(
   async()=>new Response(JSON.stringify({ok:false,code:'fanout_source_channel_limit',private:'not forwarded'}),{status:503,headers:{'content-type':'application/json','retry-after':'2'}}),
   (res,status,body,ct,h)=>{res.status=status;res.body=body;headers=h},
   async()=>{throw Error('unexpected pipeline')},{fromWeb:x=>x});
 const req={once(){},off(){},aborted:false};
 const res={once(){},off(){},destroyed:false,headersSent:false};
 await run(req,res,'https://blofy-stream-api-production.up.railway.app/relay/'+'a'.repeat(48),(phase,d)=>{reason=d.reason});
 assert.equal(res.status,503);assert.equal(reason,'fanout_source_channel_limit');
 assert.equal(headers['retry-after'],'2');assert.equal(headers['x-blofy-live-status'],reason);
 assert.equal(res.body,'Provider concurrent channel limit reached');
});


test('explicit five-feed trial requires a unique approved source, reported one slot, and bounded active window',()=>{
 const now=Date.parse('2026-11-27T05:00:00Z');
 const cfg={...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1',
  BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1',
  BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_TRIAL:'1',
  BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_UNTIL:'2026-11-27T05:20:00Z'};
 const row={sourceId:source,sourceName:'saleh',sourceNameMatches:1,providerMaxConcurrentFeeds:1};
 assert.equal(authorizedLiveTrialQuota(row,cfg,now),5);
 assert.equal(authorizedLiveTrialQuota(row,cfg,now+20*60000),1);
 assert.equal(authorizedLiveTrialQuota(row,cfg,now-11*60000),1);
 assert.equal(authorizedLiveTrialQuota(row,env,now),1);
 assert.equal(authorizedLiveTrialQuota({...row,sourceName:'other'},cfg,now),1);
 assert.equal(authorizedLiveTrialQuota({...row,sourceNameMatches:2},cfg,now),1);
 assert.equal(authorizedLiveTrialQuota({...row,providerMaxConcurrentFeeds:null},cfg,now),null);
 assert.equal(authorizedLiveTrialQuota({...row,providerMaxConcurrentFeeds:2},cfg,now),2);
 for(const flag of ['BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED','BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED','BLOFY_STREAM_SHARED_LIVE_CANARY','BLOFY_STREAM_LICENSED_LIVE_PRODUCTION','BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_TRIAL'])
  assert.equal(authorizedLiveTrialQuota(row,{...cfg,[flag]:'0'},now),1);
});


test('persistent five-feed ceiling survives trial expiry only for the explicitly approved source',()=>{
 const now=Date.parse('2026-11-27T06:00:00Z');
 const cfg={...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1',
  BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1',
  BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_PERSISTENT:'1',
  BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_TRIAL:'0',
  BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_UNTIL:'2026-11-27T05:17:00Z'};
 const row={sourceId:source,sourceName:'saleh',sourceNameMatches:1,providerMaxConcurrentFeeds:1};
 assert.equal(authorizedLiveTrialQuota(row,cfg,now),5);
 assert.equal(authorizedLiveTrialQuota(row,cfg,now+86400000),5);
 assert.equal(authorizedLiveTrialQuota(row,{...cfg,BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_PERSISTENT:'0'},now),1);
 assert.equal(authorizedLiveTrialQuota({...row,sourceName:'other'},cfg,now),1);
 assert.equal(authorizedLiveTrialQuota({...row,sourceNameMatches:2},cfg,now),1);
 assert.equal(authorizedLiveTrialQuota({...row,providerMaxConcurrentFeeds:null},cfg,now),null);
 for(const flag of ['BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED','BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED','BLOFY_STREAM_SHARED_LIVE_CANARY','BLOFY_STREAM_LICENSED_LIVE_PRODUCTION'])
  assert.equal(authorizedLiveTrialQuota(row,{...cfg,[flag]:'0'},now),1);
});


test('explicit source-specific approved capacity is configurable but bounded and never global',()=>{
 const cfg={...env,BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'saleh',
  BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1',
  BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1',
  BLOFY_XTREAM_AUTHORIZED_FIVE_FEED_PERSISTENT:'1'};
 const row={sourceId:source,sourceName:'saleh',sourceNameMatches:1,providerMaxConcurrentFeeds:1};
 for(const n of [1,5,8,16,32,64]){
  const configured={...cfg,BLOFY_XTREAM_AUTHORIZED_SOURCE_FEED_CEILING:String(n)};
  assert.equal(authorizedLiveTrialQuota(row,configured),n);
  assert.equal(authorizedLiveTrialQuota({...row,sourceName:'other'},configured),1);
  assert.equal(authorizedLiveTrialQuota({...row,sourceNameMatches:2},configured),1);
 }
 for(const invalid of ['0','65','100','*','unlimited','8.5','-1']){
  assert.equal(authorizedLiveTrialQuota(row,{...cfg,BLOFY_XTREAM_AUTHORIZED_SOURCE_FEED_CEILING:invalid}),5);
 }
});
