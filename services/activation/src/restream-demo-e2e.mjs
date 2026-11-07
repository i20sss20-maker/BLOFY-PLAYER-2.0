// Operator-only proof of the SYNTHETIC HLS session through BLOFY's own
// authenticated public-route handler. Makes loopback requests only; it never
// accepts remote hosts, subscriber credentials or user-selected media IDs.
import {DEMO_PREFIX} from './restream-demo-hls.mjs';

const ALLOWED_ASSET=/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:m3u8|ts)$/;
const MAX_PLAYLIST=64*1024;
export function demoProxyLoopbackOrigin(port=3000){
  const n=Number(port);
  if(!Number.isSafeInteger(n)||n<1024||n>65535)
    throw new Error('demo_proxy_loopback_invalid');
  return 'http://127.0.0.1:'+n;
}
function pathFor(ref,base,origin){
  let url;
  try{url=new URL(ref,base)}catch{throw new Error('demo_proxy_unsafe_asset')}
  if(url.origin!==origin||!url.pathname.startsWith(DEMO_PREFIX)||
      !ALLOWED_ASSET.test(url.pathname.slice(DEMO_PREFIX.length))||
      url.username||url.password||url.hash||url.search.length>240)
    throw new Error('demo_proxy_unsafe_asset');
  return url;
}
function hlsCookie(response,current){
  const cookieHeaders=typeof response.headers.getSetCookie==='function'
    ?response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);
  const found=[];
  for(const value of cookieHeaders.slice(0,8)){
    const raw=String(value).split(';')[0].trim();
    if(/^blofy_hls_[A-Za-z0-9_-]{1,40}=[A-Za-z0-9._~+\/=-]{1,256}$/.test(raw))
      found.push(raw);
  }
  return found.length?found.slice(0,4).join('; '):current;
}
async function readLimited(response,{maxBytes=MAX_PLAYLIST,partial=false}={}){
  if(!response.body)throw new Error('demo_proxy_empty');
  const reader=response.body.getReader();
  let done=false,size=0;const parts=[];
  try{
    for(;;){
      const next=await reader.read();
      if(next.done){done=true;break;}
      const data=Buffer.from(next.value||[]);
      const remaining=maxBytes-size;
      if(remaining<=0){if(partial)break;throw new Error('demo_proxy_too_large');}
      if(data.length>remaining){
        if(!partial)throw new Error('demo_proxy_too_large');
        parts.push(data.subarray(0,remaining));size+=remaining;break;
      }
      parts.push(data);size+=data.length;
      if(partial&&size>=maxBytes)break;
    }
    return Buffer.concat(parts,size);
  }finally{
    if(!done){try{await reader.cancel()}catch{}}
    try{reader.releaseLock()}catch{}
  }
}
function firstResource(text){
  return String(text).split(/\r?\n/).map(line=>line.trim())
    .find(line=>line&&!line.startsWith('#'))||null;
}
function firstSegment(text){
  const m=/#EXTINF:[^\r\n]*\r?\n([^#\r\n]+)/.exec(text);
  return m?.[1]?.trim()||null;
}
export async function checkDemoProxy({
  port=3000,adminToken,fetchImpl=fetch,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  clock=()=>Date.now()
}={}){
  const started=clock();
  if(typeof adminToken!=='string'||!adminToken)
    return {ok:false,stage:'auth',reason:'demo_proxy_admin_not_configured',
      realSourceVerified:false,mediaVerified:false};
  let origin;
  try{origin=demoProxyLoopbackOrigin(port)}
  catch{return {ok:false,stage:'configuration',reason:'demo_proxy_loopback_invalid',
    realSourceVerified:false,mediaVerified:false};}
  let cookie='',stage='master',failedHttpStatus=null;
  async function load(ref,base){
    const url=pathFor(ref,base,origin);
    let response;
    try{
      response=await fetchImpl(url,{method:'GET',redirect:'manual',
        signal:AbortSignal.timeout(12000),
        headers:{authorization:'Bearer '+adminToken,
          accept:'application/vnd.apple.mpegurl,video/mp2t',
          ...(cookie?{cookie}:{})}});
    }catch{throw new Error('demo_proxy_unreachable');}
    cookie=hlsCookie(response,cookie);
    if(!response.ok){
      const status=response.status;
      failedHttpStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
      await response.body?.cancel().catch(()=>{});
      throw new Error(status===401?'demo_proxy_unauthorized':'demo_proxy_http_error');
    }
    return {url,response};
  }
  try{
    const entry=await load(DEMO_PREFIX+'index.m3u8',origin+'/');
    let playlist=(await readLimited(entry.response)).toString('utf8');
    if(!playlist.startsWith('#EXTM3U'))throw new Error('demo_proxy_playlist_invalid');
    let base=entry.url;
    if(playlist.includes('#EXT-X-STREAM-INF')){
      const ref=firstResource(playlist);
      if(!ref)throw new Error('demo_proxy_variant_missing');
      stage='variant';
      const variant=await load(ref,base);
      base=variant.url;
      playlist=(await readLimited(variant.response)).toString('utf8');
      if(!playlist.startsWith('#EXTM3U'))throw new Error('demo_proxy_playlist_invalid');
    }
    stage='segment';
    let ref=firstSegment(playlist);
    for(let i=0;!ref&&i<3;i++){
      await delay(1100);
      const retry=await load(base.toString(),base);
      playlist=(await readLimited(retry.response)).toString('utf8');
      ref=firstSegment(playlist);
    }
    if(!ref)throw new Error('demo_proxy_segment_missing');
    const chunk=await load(ref,base);
    const bytes=await readLimited(chunk.response,{maxBytes:188*3,partial:true});
    if(bytes.length<376||bytes[0]!==0x47||bytes[188]!==0x47)
      throw new Error('demo_proxy_not_mpegts');
    return {ok:true,stage:'segment',reason:'synthetic_hls_proxy_verified',
      bytesVerified:bytes.length,elapsedMs:clock()-started,
      authVerified:true,realSourceVerified:false,mediaVerified:true,audioVideoDecoded:false};
  }catch(e){
    const allowed=new Set(['demo_proxy_unreachable','demo_proxy_unauthorized','demo_proxy_http_error',
      'demo_proxy_playlist_invalid','demo_proxy_variant_missing','demo_proxy_segment_missing',
      'demo_proxy_not_mpegts','demo_proxy_unsafe_asset','demo_proxy_empty','demo_proxy_too_large']);
    return {ok:false,stage,reason:allowed.has(e?.message)?e.message:'demo_proxy_failed',
      httpStatus:failedHttpStatus,elapsedMs:clock()-started,
      realSourceVerified:false,mediaVerified:false,audioVideoDecoded:false};
  }
}
