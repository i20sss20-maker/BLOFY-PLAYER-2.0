// Private, synthetic-only MediaMTX HLS acceptance test. Never accepts a
// client URL, a source account, a provider host or a stream ID.
import {normalizePrivateRestreamOrigin} from './restream-engine-core.mjs';

const PATH='/smoke/';
function targetUrl(reference,base,origin){
  let url;
  try{url=new URL(reference,base);}catch{throw new Error('restream_smoke_invalid_path');}
  if(url.origin!==origin || !url.pathname.startsWith(PATH) ||
      url.username || url.password || url.hash ||
      /[\\\r\n]/.test(String(reference)))
    throw new Error('restream_smoke_invalid_path');
  return url;
}
function mediaRef(playlist){
  for(const line of playlist.split(/\r?\n/)){
    const value=line.trim();
    if(value && !value.startsWith('#'))return value;
  }
  return null;
}
function cookiesFrom(headers,existing){
  const raw=typeof headers.getSetCookie==='function'
    ?headers.getSetCookie()
    :[headers.get?.('set-cookie')].filter(Boolean);
  for(const c of raw){
    const item=String(c).split(';')[0].trim();
    if(item.length<=180 && /^[a-zA-Z0-9_\-]+=[a-zA-Z0-9_\-\.]+$/.test(item))return item;
  }
  return existing;
}
async function readBounded(response,{limitBytes=48*1024,firstBytesOnly=false}={}){
  if(!response.body)throw new Error('restream_smoke_empty_body');
  const reader=response.body.getReader();
  let size=0,done=false;const parts=[];
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done){done=true;break;}
      const bytes=Buffer.from(chunk.value||[]);
      size+=bytes.length;
      if(!firstBytesOnly && size>limitBytes)throw new Error('restream_smoke_response_too_large');
      if(firstBytesOnly){
        const remaining=limitBytes-Buffer.concat(parts).length;
        if(remaining>0)parts.push(bytes.subarray(0,remaining));
        if(Buffer.concat(parts).length>=limitBytes)break;
      }else parts.push(bytes);
    }
    return Buffer.concat(parts);
  }finally{
    if(!done){try{await reader.cancel();}catch{}}
    try{reader.releaseLock();}catch{}
  }
}
export async function verifyRestreamSmoke(originInput,{
  fetchImpl=fetch,timeoutMs=12000,wait=ms=>new Promise(r=>setTimeout(r,ms))
}={}){
  const origin=normalizePrivateRestreamOrigin(originInput);
  if(!origin)return {ok:false,stage:'configuration',code:'restream_not_configured',mediaVerified:false};
  const startedAt=Date.now();
  let cookie='';
  async function load(ref,base){
    let url=targetUrl(ref,base,origin);
    for(let redirects=0;redirects<=3;redirects++){
      let response;
      try{
        response=await fetchImpl(url,{method:'GET',redirect:'manual',
          signal:AbortSignal.timeout(timeoutMs),
          headers:{accept:'application/vnd.apple.mpegurl,video/mp2t,*/*',
            ...(cookie?{cookie}:{})}});
      }catch{
        throw new Error('restream_smoke_engine_unreachable');
      }
      cookie=cookiesFrom(response.headers,cookie);
      if([301,302,303,307,308].includes(response.status)){
        const next=response.headers.get('location');
        await response.body?.cancel().catch(()=>{});
        if(!next||redirects===3)throw new Error('restream_smoke_redirect_invalid');
        url=targetUrl(next,url,origin);
        continue;
      }
      if(!response.ok){
        const status=response.status;
        await response.body?.cancel().catch(()=>{});
        throw new Error(status===401||status===403?'restream_smoke_auth_rejected':
          status===404?'restream_smoke_not_published':'restream_smoke_http_error');
      }
      return {response,url};
    }
    throw new Error('restream_smoke_redirect_invalid');
  }
  let stage='master';
  try{
    const master=await load('/smoke/index.m3u8',origin+'/smoke/');
    const masterBody=await readBounded(master.response);
    const masterText=masterBody.toString('utf8');
    if(!masterText.startsWith('#EXTM3U'))throw new Error('restream_smoke_manifest_invalid');
    let playlist=masterText,playlistUrl=master.url;
    if(masterText.includes('#EXT-X-STREAM-INF')){
      const variant=mediaRef(masterText);
      if(!variant)throw new Error('restream_smoke_variant_missing');
      stage='variant';
      const found=await load(variant,master.url);
      playlist=(await readBounded(found.response)).toString('utf8');
      playlistUrl=found.url;
    }
    if(!playlist.startsWith('#EXTM3U'))throw new Error('restream_smoke_manifest_invalid');
    stage='segment';
    let segment=null;
    // MediaMTX can publish the first playlist before its first complete TS
    // segment. Only retry the private playlist, never the source provider.
    for(let attempt=0;attempt<4;attempt++){
      const match=/#EXTINF:[^\r\n]*\r?\n([^#\r\n]+)/.exec(playlist);
      if(match){segment=match[1].trim();break;}
      if(attempt===3)break;
      await wait(1200);
      const next=await load(playlistUrl.toString(),playlistUrl);
      playlist=(await readBounded(next.response)).toString('utf8');
    }
    if(!segment)throw new Error('restream_smoke_segment_missing');
    const file=await load(segment,playlistUrl);
    const first=await readBounded(file.response,{limitBytes:188*3,firstBytesOnly:true});
    const ts=first.length>=188 && first[0]===0x47 &&
      (first.length<376 || first[188]===0x47);
    if(!ts)throw new Error('restream_smoke_not_mpegts');
    return {ok:true,stage:'segment',code:'synthetic_hls_ts_verified',
      mediaVerified:true,realSourceVerified:false,audioVideoDecoded:false,
      bytesVerified:first.length,elapsedMs:Date.now()-startedAt};
  }catch(error){
    const known=new Set(['restream_smoke_invalid_path','restream_smoke_response_too_large',
      'restream_smoke_empty_body','restream_smoke_engine_unreachable',
      'restream_smoke_redirect_invalid','restream_smoke_auth_rejected',
      'restream_smoke_not_published','restream_smoke_http_error',
      'restream_smoke_manifest_invalid','restream_smoke_variant_missing',
      'restream_smoke_segment_missing','restream_smoke_not_mpegts']);
    const code=known.has(error?.message)?error.message:'restream_smoke_failed';
    return {ok:false,stage,code,mediaVerified:false,realSourceVerified:false,
      audioVideoDecoded:false,elapsedMs:Date.now()-startedAt};
  }
}
