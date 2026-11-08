// One-shot comparison against official M3U stream destinations from the
// standalone STREAM Railway egress. All provider credentials stay in an HTTPS
// request body, response is a strict sanitized diagnostics subset only.
const ENDPOINT='https://blofy-stream-api-production.up.railway.app';
const CODE=new Set(['connection_reset','timeout','connection_refused','dns_unavailable','transport_error','http_status',
 'sample_ready','body_complete','manifest_not_allowlisted','no_advertised_media_url',
 'unsafe_advertised_url']);
const ROUTE=new Set(['live','movie','series','other']);
const FORMAT=new Set(['none','playlist','error_document','mpegts','mp4','mkv','avi','unknown']);
export async function probeOfficialXtreamPlaylistRoute(manifestUrl,{
 env=process.env,fetchImpl=fetch
}={}){
 const key=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
 if(env.BLOFY_STREAM_RELAY_ORIGIN!==ENDPOINT||key.length<32)
   return {ok:false,code:'bridge_not_configured'};
 if(typeof manifestUrl!=='string'||manifestUrl.length>2500)
   return {ok:false,code:'manifest_url_invalid'};
 try{
  const response=await fetchImpl(ENDPOINT+'/internal/xtream-official-m3u-diagnostic',{
   method:'POST',redirect:'manual',
   headers:{'authorization':'Bearer '+key,'content-type':'application/json',
     'accept':'application/json'},
   body:JSON.stringify({manifestUrl}),
   signal:AbortSignal.timeout(40000)
  });
  if(response.status!==200){
   await response.body?.cancel().catch(()=>{});
   return {ok:false,code:'probe_denied',httpStatus:response.status};
  }
  if(Number(response.headers.get('content-length')||0)>4000)
   throw Error('oversize');
  const data=await response.arrayBuffer();
  if(data.byteLength>4000)throw Error('oversize');
  const d=JSON.parse(Buffer.from(data).toString('utf8'));
  const checks=Array.isArray(d?.checks)?d.checks.slice(0,3).map(c=>({
    index:Number.isInteger(c.index)&&c.index>=1&&c.index<=3?c.index:null,
    route:ROUTE.has(c.route)?c.route:null,
    stage:c.stage==='media'?'media':c.stage==='validation'?'validation':null,
    sameOrigin:typeof c.sameOrigin==='boolean'?c.sameOrigin:null,
    scheme:c.scheme==='https'?'https':c.scheme==='http'?'http':null,
    httpStatus:Number.isInteger(c.httpStatus)&&c.httpStatus>=100&&c.httpStatus<=599?c.httpStatus:null,
    code:CODE.has(c.code)?c.code:'unknown',
    format:FORMAT.has(c.format)?c.format:'unknown',
    mediaBytesPresent:c.mediaBytesPresent===true,
    redirectPresent:c.redirectPresent===true,
    redirectPublic:typeof c.redirectPublic==='boolean'?c.redirectPublic:null,
    redirectSameOrigin:typeof c.redirectSameOrigin==='boolean'?c.redirectSameOrigin:null,
    redirectStatus:Number.isInteger(c.redirectStatus)&&c.redirectStatus>=100&&c.redirectStatus<=599?c.redirectStatus:null,
    redirectCode:CODE.has(c.redirectCode)?c.redirectCode:null,
    redirectMediaFormat:FORMAT.has(c.redirectMediaFormat)?c.redirectMediaFormat:null
  })):[];
  return {ok:d?.ok===true,code:CODE.has(d?.code)?d.code:null,
    stage:['validation','manifest','compared'].includes(d?.stage)?d.stage:'unknown',
    playlistHttpStatus:Number.isInteger(d?.playlistHttpStatus)?d.playlistHttpStatus:null,
    mediaUrlsFound:Number.isInteger(d?.playlistMediaUrlsFound)?d.playlistMediaUrlsFound:0,
    anyDifferentMediaOrigin:d?.anyDifferentMediaOrigin===true,
    mediaTransportVerified:d?.mediaTransportVerified===true,
    checks,audioVideoDecoded:false,customerCutover:false
  };
 }catch{return {ok:false,code:'probe_unreachable',customerCutover:false};}
}
