// Bounded read-only detection of the official Xtream get.php M3U export.
// No playlist contents, account credentials, stream URLs, hostnames or
// provider error text are returned or logged.
import {assertPublicXtreamUrl,xtreamM3uUrl} from './xtream-core.mjs';
import {safeXtreamTransportCategory} from './xtream-transport-errors.mjs';

const safeStatus=status=>Number.isInteger(status)&&status>=100&&status<=599?status:null;
export async function probeXtreamM3uAvailability({baseUrl,username,password},{
  fetchImpl=fetch,checkPublic=assertPublicXtreamUrl,timeoutMs=8000
}={}){
  const url=xtreamM3uUrl(baseUrl,username,password);
  await checkPublic(url.origin);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{
      method:'GET',redirect:'manual',signal:controller.signal,
      headers:{accept:'audio/x-mpegurl,text/plain,*/*','user-agent':'BLOFY-Xtream/1.0'}
    });
    const status=safeStatus(response.status);
    if(status!==200){
      await response.body?.cancel().catch(()=>{});
      return {ok:false,stage:'http',status,
        code:status?'xtream_m3u_http_'+status:'xtream_m3u_http_unexpected'};
    }
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    if(contentType.includes('text/html')){
      await response.body?.cancel().catch(()=>{});
      return {ok:false,stage:'content',status,code:'xtream_m3u_html_response'};
    }
    const reader=response.body?.getReader();
    if(!reader)return {ok:false,stage:'content',status,code:'xtream_m3u_empty'};
    try{
      const first=await reader.read();
      const head=Buffer.from(first.value||[]).subarray(0,256).toString('utf8').trimStart();
      return {ok:head.startsWith('#EXTM3U'),stage:'content',status,
        code:head.startsWith('#EXTM3U')?'xtream_m3u_reachable':'xtream_m3u_invalid_header'};
    }finally{
      await reader.cancel().catch(()=>{});
    }
  }catch(error){
    return {ok:false,stage:'transport',status:null,
      code:safeXtreamTransportCategory(error)||'xtream_m3u_unreachable'};
  }finally{
    clearTimeout(timer);
    controller.abort();
  }
}
