import {parseApprovedM3u} from './approved-m3u-catalog.mjs';
// Intended for isolated browser-side imports only. No backend URL proxy.
// Explicit HTTPS origins must be supplied by operator policy, not by a URL
// submitted by the subscriber. No cookies, referrer or redirect following.
export async function loadApprovedM3u(raw,{approvedOrigins,fetchImpl,signal}={}){
 if(typeof fetchImpl!=='function')throw Error('playlist_transport_missing');
 if(typeof raw!=='string'||raw.length>4096||/[\u0000-\u001f\u007f]/.test(raw))throw Error('invalid_playlist_url');
 let url;try{url=new URL(raw)}catch{throw Error('invalid_playlist_url')}
 const origins=new Set(approvedOrigins||[]);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||!origins.has(url.origin))throw Error('provider_not_approved');
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)throw Error('playlist_aborted');
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,15000);
 let reader;
 try{
  const res=await fetchImpl(url.href,{method:'GET',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
  if(!res.ok||res.redirected||res.type==='opaque'||(res.url&&res.url!==url.href))throw Error('playlist_response_invalid');
  const max=8*1024*1024,length=res.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw Error('playlist_too_large');
  reader=res.body?.getReader();if(!reader)throw Error('playlist_response_invalid');
  const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  while(true){
   const part=await reader.read();if(part.done)break;
   bytes+=part.value.byteLength;if(bytes>max)throw Error('playlist_too_large');
   text+=decoder.decode(part.value,{stream:true});
  }
  return parseApprovedM3u(text+decoder.decode(),{baseUrl:url.href,approvedOrigins});
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',abort);
  controller.abort();
  try{void reader?.cancel().catch(()=>{})}catch{}
 }
}

// Xtream's standard M3U export is a browser-only entry path for approved
// providers. Credentials never go to the BLOFY account API or local storage.
export function approvedXtreamPlaylistUrl({host,username,password},approvedOrigins){
 if(typeof host!=='string'||host.length>512||host!==host.trim()||/[\u0000-\u001f\u007f]/.test(host))throw Error('invalid_provider_host');
 let url;try{url=new URL(host)}catch{throw Error('invalid_provider_host')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!new Set(approvedOrigins||[]).has(url.origin))throw Error('provider_not_approved');
 for(const value of [username,password])if(typeof value!=='string'||!value.length||value.length>256||/[\u0000-\u001f\u007f]/.test(value))throw Error('invalid_credentials');
 const target=new URL('/get.php',url.origin);
 target.searchParams.set('username',username);target.searchParams.set('password',password);
 target.searchParams.set('type','m3u_plus');target.searchParams.set('output','m3u8');
 return target.href;
}
