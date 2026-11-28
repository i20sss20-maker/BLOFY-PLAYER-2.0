import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 relayConfiguration,relayEligible,issueStreamRelayGrant,checkStreamRelayBridge,isConfiguredRelayTicket,
 checkStreamRelaySyntheticMedia
} from '../src/xtream-stream-relay-bridge.mjs';
const account='b27ee9da-2f71-4ae3-a1ce-a5e051f60937';
const key='stream-relay-test-key-with-at-least-32-random-characters';
const origin='https://blofy-stream-api-production.up.railway.app';
const enabled={BLOFY_STREAM_RELAY_ORIGIN:origin,BLOFY_STREAM_RELAY_SHARED_TOKEN:key,
  BLOFY_STREAM_RELAY_ENABLED:'1',BLOFY_STREAM_RELAY_CANARY_ACCOUNT_IDS:account};
test('new relay remains disabled by default even if a URL and shared token exist',()=>{
  assert.equal(relayEligible({accountId:account,kind:'live',extension:'ts'},{
    BLOFY_STREAM_RELAY_ORIGIN:origin,BLOFY_STREAM_RELAY_SHARED_TOKEN:key}),false);
  assert.equal(relayEligible({accountId:account,kind:'live',extension:'ts'},
    {...enabled,BLOFY_STREAM_RELAY_CANARY_ACCOUNT_IDS:''}),false);
  assert.equal(relayEligible({accountId:'a3b5fce3-71c9-40aa-b7d2-910ab6a5ff71',
    kind:'live',extension:'ts'},enabled),false);
  assert.equal(relayEligible({accountId:account,kind:'live',extension:'m3u8'},enabled),false);
  assert.equal(relayEligible({accountId:account,kind:'live',extension:'ts'},enabled),true);
  assert.equal(relayEligible({accountId:account,kind:'movie',extension:'mp4'},enabled),true);
});
test('bridge cannot be redirected to another Railway project or arbitrary HTTPS domain',()=>{
  assert.equal(relayConfiguration({...enabled,BLOFY_STREAM_RELAY_ORIGIN:'https://another.up.railway.app'}).enabled,false);
  assert.equal(relayConfiguration({...enabled,BLOFY_STREAM_RELAY_ORIGIN:'http://blofy-stream-api-production.up.railway.app'}).enabled,false);
  assert.equal(relayConfiguration({...enabled,BLOFY_STREAM_RELAY_SHARED_TOKEN:'weak'}).enabled,false);
});
test('media grant requests are server-to-server and expose only opaque URL to player',async()=>{
  let calls=0;
  const url=await issueStreamRelayGrant({kind:'movie',
    sourceUrl:'http://licensed-provider.example/movie/account/password/45.mp4'},{
    env:enabled,fetchImpl:async (uri,options)=>{
      calls++;
      assert.equal(uri,origin+'/internal/relay-grants');
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'manual');
      assert.equal(options.headers.authorization,'Bearer '+key);
      const parsed=JSON.parse(options.body);
      assert.equal(parsed.kind,'movie');
      assert.equal(parsed.sourceUrl,'http://licensed-provider.example/movie/account/password/45.mp4');
      return new Response(JSON.stringify({
        ok:true,path:'/relay/'+('f'.repeat(48)),expiresInSeconds:45
      }),{status:201});
    }});
  assert.equal(calls,1);
  assert.equal(url,origin+'/relay/'+('f'.repeat(48)));
  assert.doesNotMatch(url,/password|licensed-provider|\/movie\//);
});
test('bridge refuses non-pinned path/host in reply and never follows redirects',async()=>{
  for(const [status,body] of [
    [201,{ok:true,path:'https://outside.example/private',expiresInSeconds:45}],
    [201,{ok:true,path:'/relay/../redirect',expiresInSeconds:45}],
    [201,{ok:true,path:'/relay/'+('b'.repeat(48)),expiresInSeconds:3600}],
    [302,{ok:true,path:'/relay/'+('b'.repeat(48)),expiresInSeconds:45}]
  ]){
    await assert.rejects(issueStreamRelayGrant({kind:'live',sourceUrl:'http://ok.example/live.ts'},{
      env:enabled,fetchImpl:async()=>new Response(JSON.stringify(body),{status})
    }),/stream_bridge_bad_response|stream_bridge_denied/);
  }
});
test('mutual shared bearer bridge proof checks remote media-plane identity',async()=>{
  const report=await checkStreamRelayBridge({env:enabled,fetchImpl:async(url,options)=>{
    assert.equal(url,origin+'/internal/relay-health');
    assert.equal(options.headers.authorization,'Bearer '+key);
    return new Response(JSON.stringify({ok:true,relayReady:true,service:'BLOFY-STREAM',role:'media_plane'}));
  }});
  assert.equal(report.ok,true);
  assert.equal(report.customerCutover,false);
  const denied=await checkStreamRelayBridge({env:enabled,fetchImpl:async()=>new Response('Unauthorized',{status:401})});
  assert.equal(denied.ok,false);
  assert.equal(denied.code,'stream_bridge_denied');
});
test('authorization and account source constraints precede optional relay handoff',async()=>{
  const hook=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const segment=hook.slice(hook.indexOf('async function proxyMedia('),hook.indexOf('async function ',hook.indexOf('async function proxyMedia(')+1));
  const auth=segment.indexOf('const account = await authenticate(');
  const filter=segment.indexOf('gatewayItemById(');
  const check=segment.indexOf('if(relayEligible({accountId:account.id');
  // A separately authorized, provider-permitted licensed shared route can
  // precede the legacy per-account canary, while both must follow ACLs.
  const licensed=segment.indexOf('permittedLicensedLiveFanout(');
  const issue=segment.indexOf('issueStreamRelayGrant(',check);
  const oldPath=segment.indexOf('checkedFetch(mediaFetchTarget');
  assert.ok(auth>=0&&filter>auth&&licensed>filter&&check>licensed&&issue>check&&oldPath>issue);
  assert.match(segment,/reason:'relay_unavailable'/);
  assert.match(segment,/res\.writeHead\(307/);
  assert.doesNotMatch(segment,/BLOFY_STREAM_RELAY_CANARY_FALLBACK'.*upstream/);
});

test('full relay transport proof stays synthetic and verifies 564 TS bytes',async()=>{
  const checked=[];
  const ts=Buffer.alloc(188*3,0);
  for(const x of [0,188,376])ts[x]=0x47;
  const id='c'.repeat(48);
  const result=await checkStreamRelaySyntheticMedia({env:enabled,fetchImpl:async(uri,options)=>{
    checked.push(uri);
    if(uri===origin+'/internal/relay-grants'){
      assert.equal(options.method,'POST');
      const payload=JSON.parse(options.body);
      assert.deepEqual(payload,{kind:'live',sourceUrl:origin+'/synthetic/transport.ts'});
      return new Response(JSON.stringify({ok:true,path:'/relay/'+id,expiresInSeconds:45}),
        {status:201});
    }
    assert.equal(uri,origin+'/relay/'+id);
    assert.equal(options.headers.range,'bytes=0-563');
    return new Response(ts,{headers:{'content-type':'video/mp2t'}});
  }});
  assert.equal(result.ok,true);
  assert.equal(result.code,'synthetic_relay_transport_verified');
  assert.equal(result.bytesVerified,564);
  assert.equal(result.realSourceVerified,false);
  assert.equal(result.audioVideoDecoded,false);
  assert.equal(result.customerCutover,false);
  assert.equal(checked.length,2);
});
test('unavailable transport proof does not misreport playable media',async()=>{
  const result=await checkStreamRelaySyntheticMedia({env:enabled,
    fetchImpl:async()=>new Response('{}',{status:503})});
  assert.equal(result.ok,false);
  assert.equal(result.realSourceVerified,false);
  assert.equal(result.audioVideoDecoded,false);
});

test('shared live canary requires separate flag and leaves movies/ordinary grants unchanged',async()=>{
  const sent=[];
  const fetchImpl=async(_uri,options)=>{
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ok:true,path:'/relay/'+('e'.repeat(48)),
      expiresInSeconds:45}),{status:201});
  };
  const sourceUrl='https://licensed.example/live/a/b/88.ts';
  for(const [kind,sharedLive,env] of [
    ['live',true,enabled],
    ['live',false,{...enabled,BLOFY_STREAM_SHARED_LIVE_CANARY:'1'}],
    ['movie',true,{...enabled,BLOFY_STREAM_SHARED_LIVE_CANARY:'1'}],
    ['live',true,{...enabled,BLOFY_STREAM_SHARED_LIVE_CANARY:'1'}]
  ]){
    await issueStreamRelayGrant({kind,sourceUrl,sharedLive},{env,fetchImpl});
  }
  assert.equal(sent[0].sharedLive,undefined);
  assert.equal(sent[1].sharedLive,undefined);
  assert.equal(sent[2].sharedLive,undefined);
  assert.equal(sent[3].sharedLive,true);
});

test('licensed channel quota is relayed only on authenticated shared TS grants',async()=>{
 const sourceId='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
 const base={sourceUrl:'https://licensed.example/live/user/key/42.ts',
  kind:'live',sharedLive:true,requireSharedLive:true,
  licensedSourceId:sourceId,providerMaxConcurrentFeeds:2};
 const payloads=[];
 const licensedEnv={...enabled,BLOFY_STREAM_SHARED_LIVE_CANARY:'1'};
 const fetchImpl=async(_url,options)=>{
  payloads.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ok:true,path:'/relay/'+'f'.repeat(48),
   expiresInSeconds:45,sharedLiveGranted:true}),{status:201});
 };
 await issueStreamRelayGrant(base,{env:licensedEnv,fetchImpl});
 assert.equal(payloads[0].licensedSourceId,sourceId);
 assert.equal(payloads[0].providerMaxConcurrentFeeds,2);
 await issueStreamRelayGrant({...base,providerMaxConcurrentFeeds:65},{env:licensedEnv,fetchImpl});
 assert.equal(payloads[1].licensedSourceId,undefined);
 assert.equal(payloads[1].providerMaxConcurrentFeeds,undefined);
 await issueStreamRelayGrant({...base,sharedLive:false,requireSharedLive:false},{env:licensedEnv,fetchImpl});
 assert.equal(payloads[2].licensedSourceId,undefined);
});

test('existing relay cutover requires explicit flag and binds opaque ticket to selected server',async()=>{
 const host='https://media2.blofyplayer.com',standby='https://media.blofyplayer.com';
 const path='/relay/'+'f'.repeat(48);
 assert.equal(relayConfiguration({...enabled,BLOFY_STREAM_RELAY_ORIGIN:host}).origin,'');
 const env={...enabled,BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'1',BLOFY_STREAM_RELAY_ORIGIN:host};
 assert.equal(relayConfiguration(env).origin,host);
 assert.equal(isConfiguredRelayTicket(host+path,env),true);
 for(const bad of [origin+path,standby+path,host+path+'?a=1',host+path+'#x',host.replace('https:','http:')+path,'https://user@media2.blofyplayer.com'+path]){
  assert.equal(isConfiguredRelayTicket(bad,env),false);
 }
 for(const bad of ['https://media2.blofyplayer.com.evil.test','https://evil.test','https://media2.blofyplayer.com:444','http://media2.blofyplayer.com']){
  assert.equal(relayConfiguration({...env,BLOFY_STREAM_RELAY_ORIGIN:bad}).origin,'');
 }
 const url=await issueStreamRelayGrant({kind:'live',sourceUrl:'https://fixture.example/synthetic.ts'},{
  env,fetchImpl:async(uri,options)=>{
   assert.equal(uri,host+'/internal/relay-grants');
   assert.equal(options.headers.authorization,'Bearer '+key);
   return new Response(JSON.stringify({ok:true,path,expiresInSeconds:45}),{status:201});
  }});
 assert.equal(url,host+path);
 assert.equal(isConfiguredRelayTicket(standby+path,{...env,BLOFY_STREAM_RELAY_ORIGIN:standby}),true);
 assert.equal(isConfiguredRelayTicket(origin+path,enabled),true);
});

test('media origin override preserves independent account and catalog requests on Railway',async()=>{
 const {shouldUseIndependentXtreamSource,fetchIndependentXtreamSource}=await import('../src/xtream-independent-catalog-relay.mjs');
 const host='https://media2.blofyplayer.com',path='/relay/'+'a'.repeat(48);
 const env={...enabled,BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'1',BLOFY_STREAM_RELAY_MEDIA_ORIGIN:host,
  BLOFY_XTREAM_INDEPENDENT_API_ENABLED:'1',BLOFY_XTREAM_INDEPENDENT_API_SOURCE_IDS:account};
 assert.equal(relayConfiguration(env).origin,host);
 assert.equal(shouldUseIndependentXtreamSource(account,env),true);
 const calls=[];
 const fetchImpl=async(uri,opts)=>{
   calls.push(uri);
   if(uri===origin+'/internal/xtream-catalog-relay')return new Response(JSON.stringify({user_info:{auth:1}}));
   if(uri===host+'/internal/relay-grants')return new Response(JSON.stringify({ok:true,path,expiresInSeconds:45}),{status:201});
   throw Error('unexpected origin');
 };
 await fetchIndependentXtreamSource('https://fixture.example/player_api.php?username=u&password=p',{env,fetchImpl});
 assert.equal(await issueStreamRelayGrant({kind:'live',sourceUrl:'https://fixture.example/fixture.ts'},{env,fetchImpl}),host+path);
 assert.deepEqual(calls,[origin+'/internal/xtream-catalog-relay',host+'/internal/relay-grants']);
 assert.equal(relayConfiguration({...env,BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'0'}).origin,'');
 assert.equal(relayConfiguration({...env,BLOFY_STREAM_RELAY_MEDIA_ORIGIN:''}).origin,origin);
});


test('maintenance refuses every new media grant before network access but keeps health reads',async()=>{
 const env={...enabled,BLOFY_LINODE_MEDIA_MAINTENANCE:'1'};
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({ok:true,relayReady:true,service:'BLOFY-STREAM',role:'media_plane'}))};
 for(const kind of ['live','movie','series'])await assert.rejects(issueStreamRelayGrant({kind,sourceUrl:'https://fixture.example/sample.ts'},{env,fetchImpl}),{message:'xtream_media_maintenance'});
 assert.equal(calls,0);
 assert.equal((await checkStreamRelayBridge({env,fetchImpl})).ok,true);
 assert.equal(calls,1);
});

test('production pair checks both pinned relays without switching customer route',async()=>{
 const {checkProductionRelayPair}=await import('../src/xtream-stream-relay-bridge.mjs');
 const host='https://media2.blofyplayer.com',backup='https://media.blofyplayer.com';
 const env={...enabled,BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'1',BLOFY_STREAM_RELAY_MEDIA_ORIGIN:host};
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push(url);
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers.authorization,'Bearer '+key);
  return url.startsWith(host)?new Response('Unavailable',{status:503}):
   new Response(JSON.stringify({ok:true,relayReady:true,service:'BLOFY-STREAM',role:'media_plane'}));
 };
 assert.deepEqual(await checkProductionRelayPair({env,fetchImpl}),{
  activeEngine:'hostbrr',hostbrr:{ok:false},linode:{ok:true},
  automaticFailoverEnabled:false,sourceReleaseVerified:false
 });
 assert.deepEqual(calls.sort(),[host+'/internal/relay-health',backup+'/internal/relay-health'].sort());
 assert.equal(relayConfiguration(env).origin,host);
 calls.length=0;
 assert.equal((await checkProductionRelayPair({env:{...env,BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'0'},fetchImpl})).activeEngine,null);
 assert.deepEqual(calls,[]);
});

test('busy portable relay diagnostic report larger than 8 KiB remains healthy, without relaxing grant response cap',async()=>{
 const health={ok:true,relayReady:true,service:'BLOFY-STREAM',role:'media_plane',
  fanout:{activeFeeds:16,viewers:150,channels:Array.from({length:16},(_,channel)=>({channel,transportClock:{samples:100,backwardAcross:2},details:'x'.repeat(1000)})),events:[]}};
 const body=JSON.stringify(health);
 assert.ok(Buffer.byteLength(body)>12633);
 const report=await checkStreamRelayBridge({env:enabled,fetchImpl:async()=>new Response(body)});
 assert.equal(report.ok,true);
 for(const withLength of [true,false]){
  const tooLarge=JSON.stringify({...health,extra:'x'.repeat(128*1024)});
  const result=await checkStreamRelayBridge({env:enabled,fetchImpl:async()=>new Response(tooLarge,{headers:withLength?{'content-length':String(Buffer.byteLength(tooLarge))}:{}})});
  assert.equal(result.ok,false);assert.equal(result.code,'stream_bridge_bad_response');
 }
 await assert.rejects(issueStreamRelayGrant({kind:'live',sourceUrl:'https://fixture.example/live.ts'},{env:enabled,fetchImpl:async()=>new Response(JSON.stringify({ok:true,path:'/relay/'+'f'.repeat(48),expiresInSeconds:45,extra:'x'.repeat(2048)}),{status:201})}),/stream_bridge_bad_response/);
});
