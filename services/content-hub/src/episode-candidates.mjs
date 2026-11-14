// Read-only episode list for the authenticated operator; this does not
// fetch media bytes or start any episode copy. No unapproved title can
// enter the durable movie manifest using this path.
const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const UUID=/^[a-f0-9-]{36}$/i;
const SAFE_ID=/^[A-Za-z0-9._-]{1,128}$/;
const EXT=new Set(['mkv','mp4','avi','ts']);
export function safeEpisodeCandidate(row){
 const id=Number(row?.gatewayId);
 const sourceId=String(row?.sourceId||'');
 const mediaId=String(row?.mediaId||'');
 const extension=String(row?.extension||'');
 const title=String(row?.title||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 if(!Number.isSafeInteger(id)||id<=0||
    !UUID.test(sourceId)||!SAFE_ID.test(mediaId)||
    !EXT.has(extension)||title.length<1||title.length>220||
    row?.sourceName!=='saleh'||row?.mediaKind!=='episode')return null;
 return {gatewayId:id,sourceId,mediaId,title,extension,
  sourceName:'saleh',mediaKind:'episode'};
}
export async function inspectEpisodeCandidates({
 env=process.env,fetchImpl=fetch,signal
}={}){
 const base={ok:false,privateOnly:true,readOnly:true,
  customerCutover:false,providerMediaRequests:0,automaticDownload:false,
  candidates:[]};
 const key=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 if(key.length<32)return {...base,code:'episode_bridge_not_configured'};
 try{
  const response=await fetchImpl(ORIGIN+
   '/internal/blofy-content-hub/episodes/candidates',{
    method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+key},
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):
     AbortSignal.timeout(6000)
   });
  if(response.status!==200)return {...base,
   code:'episode_catalog_not_available'};
  const data=await response.json();
  if(!data?.ok||data.readOnly!==true||
    !Array.isArray(data.candidates)||data.candidates.length>12)
   return {...base,code:'episode_catalog_response_invalid'};
  const candidates=data.candidates.map(safeEpisodeCandidate).filter(Boolean);
  if(candidates.length!==data.candidates.length)
   return {...base,code:'episode_catalog_contains_invalid_item'};
  return {...base,ok:true,code:'episode_candidates_ready',
    candidates,selectionRequired:true};
 }catch{return {...base,code:'episode_catalog_request_failed'}}
}
