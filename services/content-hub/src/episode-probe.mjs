// No automatic media copies. A confirmed, explicit operator action
// probes a single 4KiB upstream range through the private Activation bridge
// and returns only container size and validator presence. Never S3 writes.
const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const base={ok:false,automaticDownload:false,stored:false,
 customerCutover:false,providerMediaRequests:0,probeBytes:0,privateOnly:true};
export async function inspectEpisodeSize({
 gatewayId,env=process.env,fetchImpl=fetch,signal
}={}){
 const id=Number(gatewayId);
 const token=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 if(!Number.isSafeInteger(id)||id<1)return {...base,
  code:'episode_id_not_selected'};
 if(token.length<32)return {...base,code:'episode_bridge_not_configured'};
 try{
  const response=await fetchImpl(ORIGIN+
   '/internal/blofy-content-hub/episodes/probe/'+id,{
    method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+token,
      'x-blofy-episode-probe':'operator-confirmed'},
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(52000)]):
      AbortSignal.timeout(52000)
   });
  if(response.status!==200)return {...base,
   code:'episode_provider_probe_failed'};
  const result=await response.json();
  if(result?.ok!==true||result.code!=='episode_4k_size_verified'||
   Number(result.gatewayId)!==id||result.sourceName!=='saleh'||
   !['mp4','mkv','ts','avi'].includes(result.extension)||
   !Number.isSafeInteger(result.expectedBytes)||
   result.expectedBytes<8192||
   result.expectedBytes>4*1024**3||
   result.probeBytes!==4096)return {...base,
    code:'episode_size_response_invalid'};
  return {...base,ok:true,code:'episode_size_preflight_verified',
   expectedBytes:result.expectedBytes,gatewayId:id,
   extension:result.extension,validatorPresent:result.validatorPresent===true,
   probeBytes:4096,providerMediaRequests:1,
   selectionRequired:true,rightsRequired:true,
   sourceQuietRequiredBeforeCopy:true};
 }catch{return {...base,code:'episode_probe_bridge_unavailable'}}
}
