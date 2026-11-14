// Exact private HTTP byte-range proof (first/middle/cross-chunk/last).
// The loopback URL is exclusively within the private Hub, not customer-facing.
const SAFE_RUN=/^[A-Za-z0-9_-]{8,80}$/;
const CHUNK=8*1024*1024;
export async function verifyPrivateSeekRanges({
 runId,bytes,port,token,fetchImpl=fetch,mediaKind='movie'
}={}){
 const baseline={ok:false,code:'private_seek_unavailable',
   privateOnly:true,customerCutover:false,providerRequests:0,
   seeksVerified:0,rangeTests:4,unauthorizedDenied:false};
 if(!['movie','episode'].includes(mediaKind)||
   !SAFE_RUN.test(String(runId||''))||
   !Number.isSafeInteger(bytes)||bytes<CHUNK+4096||
   !Number.isSafeInteger(port)||port<1||port>65535||
   typeof token!=='string'||token.length<32)return baseline;
 const base='http://127.0.0.1:'+port+
   (mediaKind==='episode'?'/internal/episodes/playback/':
    '/internal/pilot/playback/')+runId;
 const headers={authorization:'Bearer '+token};
 const opts={redirect:'manual',cache:'no-store'};
 let passed=0,authDenied=false;
 try{
  const anon=await fetchImpl(base,{...opts,method:'HEAD',
    signal:AbortSignal.timeout(10000)});
  if(anon.status!==401) return {...baseline,code:'private_seek_auth_missing'};
  authDenied=true;
  const head=await fetchImpl(base,{...opts,method:'HEAD',headers,
    signal:AbortSignal.timeout(10000)});
  if(head.status!==200||
     Number(head.headers.get('content-length'))!==bytes||
     head.headers.get('accept-ranges')!=='bytes')
   return {...baseline,unauthorizedDenied:true,
    code:'private_seek_head_invalid'};
  const mid=Math.floor(bytes/2);
  const positions=[
   {from:0,to:4095},
   {from:mid,to:mid+4095},
   {from:CHUNK-2048,to:CHUNK+2047},
   {from:bytes-4096,to:bytes-1}
  ];
  for(const {from,to} of positions){
   const response=await fetchImpl(base,{...opts,method:'GET',
    headers:{...headers,range:`bytes=${from}-${to}`},
    signal:AbortSignal.timeout(20000)});
   if(response.status!==206||
      response.headers.get('content-range')!==`bytes ${from}-${to}/${bytes}`||
      Number(response.headers.get('content-length'))!==to-from+1)
    return {...baseline,unauthorizedDenied:authDenied,
      seeksVerified:passed,code:'private_seek_invalid_range_response'};
   const body=await response.arrayBuffer();
   if(body.byteLength!==to-from+1)
    return {...baseline,unauthorizedDenied:authDenied,
      seeksVerified:passed,code:'private_seek_body_short'};
   passed++;
  }
  return {...baseline,ok:true,code:'private_seek_ranges_verified',
   seeksVerified:passed,unauthorizedDenied:authDenied};
 }catch{return {...baseline,unauthorizedDenied:authDenied,
   seeksVerified:passed,code:'private_seek_read_failed'}}
}
