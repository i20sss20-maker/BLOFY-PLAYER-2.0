// Administrator-only synthetic HLS preview bridge for BLOFY ONE.
// Nothing here accepts a source URL, account, catalog ID or publisher path.
// The outer restream-engine hook MUST authorize every GET before invoking it.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {normalizePrivateRestreamOrigin} from './restream-engine-core.mjs';

export const DEMO_PREFIX='/api/v1/admin/restream-engine/demo/smoke/';
const HLS_ORIGIN_PATH='/smoke/';
const ASSET=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(?:m3u8|ts)$/;
const COOKIE_NAME=/^[A-Za-z0-9_-]{1,40}$/;
const COOKIE_VALUE=/^[A-Za-z0-9._~+/=-]{1,256}$/;
const MAX_PLAYLIST=64*1024,MAX_SEGMENT=12*1024*1024;
function validAsset(url,origin){
  if(url.origin!==origin||!url.pathname.startsWith(HLS_ORIGIN_PATH)||
      !ASSET.test(url.pathname.slice(HLS_ORIGIN_PATH.length))||
      url.hash||url.username||url.password||url.search.length>240)
    throw new Error('restream_demo_invalid_asset');
  // MediaMTX HLS uses only local paths. No user-supplied fetch targets.
  for(const key of url.searchParams.keys()){
    if(!['_HLS_msn','_HLS_part','_HLS_skip','session'].includes(key))
      throw new Error('restream_demo_invalid_asset');
  }
  return url;
}
function writeJson(res,status,code){
  if(res.headersSent)return res.destroy();
  const text=JSON.stringify({ok:false,code});
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'content-length':Buffer.byteLength(text)});
  res.end(text);
}
function parseBrowserCookies(req){
  const cookies=new Map();
  for(const pair of String(req.headers.cookie||'').split(';').slice(0,40)){
    const equals=pair.indexOf('=');
    if(equals<1)continue;
    const name=pair.slice(0,equals).trim(),value=pair.slice(equals+1).trim();
    if(name.startsWith('blofy_hls_')){
      const inner=name.slice('blofy_hls_'.length);
      if(COOKIE_NAME.test(inner)&&COOKIE_VALUE.test(value)&&cookies.size<4)
        cookies.set(inner,value);
    }
  }
  return cookies;
}
function learnCookies(headers,cookies){
  const raw=typeof headers?.getSetCookie==='function'?headers.getSetCookie():
    [headers?.get?.('set-cookie')].filter(Boolean);
  for(const entry of raw.slice(0,8)){
    const part=String(entry).split(';')[0];
    const equals=part.indexOf('=');
    if(equals<1)continue;
    const name=part.slice(0,equals).trim(),value=part.slice(equals+1).trim();
    if(COOKIE_NAME.test(name)&&COOKIE_VALUE.test(value)&&
        (cookies.has(name)||cookies.size<4))cookies.set(name,value);
  }
}
function outputHeaders(cookies){
  return {
    'cache-control':'private, no-store',
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'no-referrer',
    'access-control-allow-origin':undefined,
    ...(cookies.size?{'set-cookie':Array.from(cookies,([k,v])=>
      'blofy_hls_'+k+'='+v+'; Path='+DEMO_PREFIX+
      '; Max-Age=600; HttpOnly; Secure; SameSite=Strict')}: {})
  };
}
async function readPlaylist(response){
  if(!response.body)throw new Error('restream_demo_empty');
  const reader=response.body.getReader();
  let done=false,size=0;const parts=[];
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done){done=true;break;}
      const bytes=Buffer.from(chunk.value||[]);
      size+=bytes.length;
      if(size>MAX_PLAYLIST)throw new Error('restream_demo_too_large');
      parts.push(bytes);
    }
    return Buffer.concat(parts,size).toString('utf8');
  }finally{
    if(!done){try{await reader.cancel()}catch{}}
    try{reader.releaseLock()}catch{}
  }
}
export function rewritePrivateDemoPlaylist(body,base,origin){
  if(!String(body).startsWith('#EXTM3U'))throw new Error('restream_demo_invalid_playlist');
  const lines=body.split(/\r?\n/),out=[];
  for(const line of lines){
    const value=line.trim();
    // Test source only: reject encrypted/extensible HLS URI tags rather than
    // accidentally leaking its internal origin to an external media client.
    if(value.startsWith('#')){
      if(/(?:URI="|URI='|KEYFORMAT=|#EXT-X-KEY|#EXT-X-MAP)/i.test(value))
        throw new Error('restream_demo_unsupported_playlist');
      out.push(line);continue;
    }
    if(!value){out.push(line);continue;}
    let u;
    try{u=validAsset(new URL(value,base),origin)}
    catch{throw new Error('restream_demo_invalid_playlist');}
    out.push(DEMO_PREFIX+u.pathname.slice(HLS_ORIGIN_PATH.length)+u.search);
  }
  return out.join('\n');
}
export async function serveRestreamDemo(req,res,{
  engineUrl,fetchImpl=fetch,timeoutMs=20000
}={}){
  if(req.method!=='GET')return writeJson(res,405,'restream_demo_method_not_allowed');
  let origin;
  try{origin=normalizePrivateRestreamOrigin(engineUrl)}
  catch{return writeJson(res,503,'restream_demo_not_configured');}
  if(!origin)return writeJson(res,503,'restream_demo_not_configured');
  let userUrl,target;
  try{
    userUrl=new URL(req.url,'https://blofyplayer.com');
    if(!userUrl.pathname.startsWith(DEMO_PREFIX))throw Error('invalid');
    const asset=userUrl.pathname.slice(DEMO_PREFIX.length);
    if(!ASSET.test(asset))throw Error('invalid');
    target=validAsset(new URL(HLS_ORIGIN_PATH+asset+userUrl.search,origin),origin);
  }catch{return writeJson(res,404,'restream_demo_not_found');}
  const cookies=parseBrowserCookies(req);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  const close=()=>controller.abort();
  res.on('close',close);
  let upstream=null;
  try{
    for(let attempt=0;attempt<4;attempt++){
      const h={'accept':'application/vnd.apple.mpegurl, video/mp2t, */*','user-agent':'BLOFY-One-Synthetic-HLS/1.0'};
      if(cookies.size)h.cookie=Array.from(cookies,([name,value])=>name+'='+value).join('; ');
      upstream=await fetchImpl(target,{method:'GET',redirect:'manual',
        headers:h,signal:controller.signal});
      learnCookies(upstream.headers,cookies);
      if([301,302,303,307,308].includes(upstream.status)){
        const location=upstream.headers.get('location');
        await upstream.body?.cancel().catch(()=>{});
        if(!location||attempt===3)throw new Error('restream_demo_redirect_invalid');
        target=validAsset(new URL(location,target),origin);
        continue;
      }
      break;
    }
    if(!upstream?.ok){
      const status=upstream?.status;
      await upstream?.body?.cancel().catch(()=>{});
      return writeJson(res,status===401||status===403?502:503,
        status===404?'restream_demo_not_published':'restream_demo_unavailable');
    }
    const isPlaylist=target.pathname.endsWith('.m3u8');
    if(isPlaylist){
      const playlist=rewritePrivateDemoPlaylist(await readPlaylist(upstream),target,origin);
      const headers=outputHeaders(cookies);
      delete headers['access-control-allow-origin'];
      const body=Buffer.from(playlist);
      res.writeHead(200,{...headers,'content-type':'application/vnd.apple.mpegurl; charset=utf-8',
        'content-length':body.length});
      res.end(body);
      return;
    }
    if(!upstream.body)throw new Error('restream_demo_empty');
    const headers=outputHeaders(cookies);
    delete headers['access-control-allow-origin'];
    res.writeHead(200,{...headers,'content-type':'video/mp2t'});
    let total=0;
    const limiter=new Transform({transform(chunk,encoding,callback){
      total+=chunk.length;
      if(total>MAX_SEGMENT)return callback(new Error('restream_demo_too_large'));
      callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(upstream.body),limiter,res,{signal:controller.signal});
  }catch(error){
    const allowed=new Set(['restream_demo_invalid_asset','restream_demo_invalid_playlist',
      'restream_demo_unsupported_playlist','restream_demo_redirect_invalid',
      'restream_demo_too_large','restream_demo_empty']);
    const raw=String(error?.cause?.code||error?.code||'');
    const network={ECONNREFUSED:'restream_demo_network_refused',
      ENOTFOUND:'restream_demo_dns_failed',EAI_AGAIN:'restream_demo_dns_failed',
      ETIMEDOUT:'restream_demo_network_timeout',ECONNRESET:'restream_demo_network_reset'};
    const code=allowed.has(error?.message)?error.message:
      network[raw]||(controller.signal.aborted?'restream_demo_network_timeout':'restream_demo_unavailable');
    if(!res.headersSent)writeJson(res,503,code);
    else if(!res.writableEnded)res.destroy();
  }finally{
    clearTimeout(timeout);
    res.off('close',close);
    if(upstream?.body&&!upstream.bodyUsed){
      try{await upstream.body.cancel()}catch{}
    }
  }
}
