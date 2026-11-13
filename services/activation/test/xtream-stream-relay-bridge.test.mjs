import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 relayConfiguration,relayEligible,issueStreamRelayGrant,checkStreamRelayBridge,
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
