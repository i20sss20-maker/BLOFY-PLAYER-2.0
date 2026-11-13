// BLOFY PLAYER stays the authoritative account, source and catalog control
// plane. STREAM only receives a 45-second opaque capability over a pinned
// HTTPS service-to-service origin. Default OFF and allowlisted BY account UUID.
const HOST='blofy-stream-api-production.up.railway.app';
const RESOURCE=/^\/relay\/[0-9a-f]{48}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function relayConfiguration(env=process.env){
  const origin=String(env.BLOFY_STREAM_RELAY_ORIGIN||'').trim();
  const token=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
  const ids=String(env.BLOFY_STREAM_RELAY_CANARY_ACCOUNT_IDS||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x));
  const valid=origin==='https://'+HOST && token.length>=32;
  return {origin:valid?origin:'',token:valid?token:'',canaryIds:new Set(ids),
    enabled:valid&&env.BLOFY_STREAM_RELAY_ENABLED==='1'};
}
export function relayEligible({accountId,kind,extension},env=process.env){
  const cfg=relayConfiguration(env);
  if(!cfg.enabled||!cfg.canaryIds.has(String(accountId||'').toLowerCase()))return false;
  if(!['live','movie','series'].includes(kind))return false;
  // No HLS manifest redirection until every segment has independent auth.
  if(kind==='live'&&String(extension||'').toLowerCase()!=='ts')return false;
  return true;
}
async function remoteRelayRequest(path,{method='GET',body,env=process.env,
  fetchImpl=fetch,timeoutMs=6000}={}){
  const cfg=relayConfiguration(env);
  if(!cfg.origin)throw new Error('stream_bridge_not_configured');
  let response;
  try{
    response=await fetchImpl(cfg.origin+path,{
      method,redirect:'manual',signal:AbortSignal.timeout(timeoutMs),
      headers:{authorization:'Bearer '+cfg.token,accept:'application/json',
        ...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
  }catch{throw new Error('stream_bridge_unreachable')}
  if(response.status!==200&&response.status!==201){
    await response.body?.cancel().catch(()=>{});
    throw new Error('stream_bridge_denied');
  }
  // Safe bounded response parser; never trust arbitrarily large foreign JSON.
  if(Number(response.headers.get('content-length')||0)>2048){
    await response.body?.cancel().catch(()=>{});
    throw new Error('stream_bridge_bad_response');
  }
  let size=0,chunks=[],reader=response.body?.getReader(),done=false;
  if(!reader)throw new Error('stream_bridge_bad_response');
  try{
    while(true){
      const item=await reader.read();
      if(item.done){done=true;break;}
      size+=item.value?.byteLength||0;
      if(size>2048)throw new Error('stream_bridge_bad_response');
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks.map(x=>Buffer.from(x))).toString('utf8'));
  }catch{throw new Error('stream_bridge_bad_response')}
  finally{
    if(!done)await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
export async function issueStreamRelayGrant({sourceUrl,kind,sharedLive=false,
  requireSharedLive=false,licensedCdnRedirect=false,
  licensedSourceId='',providerMaxConcurrentFeeds=null},{
  env=process.env,fetchImpl=fetch}={}){
  if(!['live','movie','series'].includes(kind)||typeof sourceUrl!=='string')
    throw new Error('stream_bridge_invalid_media');
  const result=await remoteRelayRequest('/internal/relay-grants',{
    method:'POST',body:{kind,sourceUrl,
      ...(kind==='live'&&sharedLive===true&&
        env.BLOFY_STREAM_SHARED_LIVE_CANARY==='1'?{
          sharedLive:true,
          // Per-channel rights and per-account subscriber pilot were
          // checked by the upstream gateway BEFORE granting this scope.
          ...(licensedCdnRedirect===true&&requireSharedLive===true?
            {licensedCdnRedirect:true}:{}),
          // No provider/source grouping for non-shared or unverified feeds.
          // This private request is authenticated by the bridge bearer.
          ...(requireSharedLive===true&&UUID.test(String(licensedSourceId))&&
            providerMaxConcurrentFeeds===1?{
              licensedSourceId:String(licensedSourceId).toLowerCase(),
              providerMaxConcurrentFeeds:1
            }:{})
        }:{})},env,fetchImpl
  });
  if(!result?.ok||typeof result.path!=='string'||!RESOURCE.test(result.path)||
      result.expiresInSeconds!==45)
    throw new Error('stream_bridge_bad_response');
  // Never silently turn a licensed shared feed into one source connection
  // PER viewer when the isolated media plane has fanout disabled.
  if(requireSharedLive===true&&(sharedLive!==true||result.sharedLiveGranted!==true))
    throw new Error('stream_shared_live_not_granted');
  return 'https://'+HOST+result.path;
}
export async function licensedLiveFanoutHealth({env=process.env,fetchImpl=fetch}={}){
  try{
    const data=await remoteRelayRequest('/internal/relay-health',{env,fetchImpl});
    if(data?.ok!==true||data?.service!=='BLOFY-STREAM'||
       data?.role!=='media_plane')throw Error('stream_bridge_bad_response');
    const f=data.fanout||{};
    const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000?x:0;
    return {ok:true,scope:'all_shared_channels_on_this_media_instance',
      sharedLiveConfigured:data.sharedLiveConfigured===true,
      activeSharedChannels:count(f.activeFeeds),activeSharedViewers:count(f.viewers),
      maxViewersPerChannelDesign:count(f.maxViewersPerFeed),
      upstreamReconnects:count(f.upstreamReconnects),
      reconnectExhaustions:count(f.reconnectExhaustions),
      slowViewerDisconnects:count(f.slowViewerDisconnects),
      real100ViewerValidationComplete:false};
  }catch{return {ok:false,code:'stream_relay_fanout_status_unavailable'};}
}
export async function checkStreamRelayBridge({env=process.env,fetchImpl=fetch}={}){
  try{
    const report=await remoteRelayRequest('/internal/relay-health',{env,fetchImpl});
    return {ok:report?.ok===true&&report?.relayReady===true&&
      report?.service==='BLOFY-STREAM'&&report?.role==='media_plane',
      controlPlane:'BLOFY PLAYER',mediaPlane:'BLOFY STREAM',customerCutover:false};
  }catch(error){
    return {ok:false,code:['stream_bridge_not_configured','stream_bridge_denied',
      'stream_bridge_unreachable','stream_bridge_bad_response'].includes(error.message)
      ?error.message:'stream_bridge_failed',customerCutover:false};
  }
}
// End-to-end opt-in transport proof using only an innocuous 564-byte fixture
// hosted by our independent STREAM API. No provider or client data is fetched.
export async function checkStreamRelaySyntheticMedia({env=process.env,fetchImpl=fetch}={}){
  const cfg=relayConfiguration(env);
  if(!cfg.origin)return {ok:false,code:'stream_bridge_not_configured',customerCutover:false};
  try{
    const path=await issueStreamRelayGrant({
      kind:'live',sourceUrl:'https://'+HOST+'/synthetic/transport.ts'
    },{env,fetchImpl});
    const response=await fetchImpl(path,{
      method:'GET',redirect:'manual',
      headers:{range:'bytes=0-563',accept:'video/mp2t'},
      signal:AbortSignal.timeout(15000)
    });
    if(response.status!==200&&response.status!==206){
      await response.body?.cancel().catch(()=>{});
      return {ok:false,code:'stream_bridge_media_http_error',
        customerCutover:false,realSourceVerified:false,audioVideoDecoded:false};
    }
    const mime=String(response.headers.get('content-type')||'').toLowerCase();
    if(!mime.startsWith('video/mp2t')){
      await response.body?.cancel().catch(()=>{});
      return {ok:false,code:'stream_bridge_media_invalid',
        customerCutover:false,realSourceVerified:false,audioVideoDecoded:false};
    }
    const reader=response.body?.getReader();
    if(!reader)throw new Error('stream_bridge_media_invalid');
    const parts=[];let count=0,done=false;
    try{
      while(true){
        const step=await reader.read();
        if(step.done){done=true;break}
        const part=Buffer.from(step.value||[]);
        if(count+part.length>564)throw new Error('stream_bridge_media_invalid');
        parts.push(part);count+=part.length;
      }
      const bytes=Buffer.concat(parts,count);
      const passed=count===564&&[0,188,376].every(i=>bytes[i]===0x47);
      return {ok:passed,code:passed?'synthetic_relay_transport_verified':'stream_bridge_media_invalid',
        bytesVerified:passed?count:0,customerCutover:false,
        realSourceVerified:false,audioVideoDecoded:false};
    }finally{
      if(!done)await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
  }catch{
    return {ok:false,code:'stream_bridge_media_unavailable',customerCutover:false,
      realSourceVerified:false,audioVideoDecoded:false};
  }
}
// Probe verifies the secret and HTTPS route. It never requests a real source
// or performs any customer cutover.
if(process.env.BLOFY_STREAM_RELAY_PROBE_MEDIA_ON_BOOT==='1'){
  const timer=setTimeout(()=>{
    void checkStreamRelaySyntheticMedia().then(r=>
      console.info('BLOFY_STREAM_RELAY_MEDIA_PROOF',JSON.stringify(r))
    );
  },14000);
  timer.unref?.();
}
if(process.env.BLOFY_STREAM_RELAY_PROBE_ON_BOOT==='1'){
  const timer=setTimeout(()=>{
    void checkStreamRelayBridge().then(r=>
      console.info('BLOFY_STREAM_BRIDGE_PROOF',JSON.stringify(r))
    );
  },9000);
  timer.unref?.();
}
