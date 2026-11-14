// Operator-confirmed, precise 4KiB byte-range size proof for ONE episode.
// This is not an episode transfer. Any upstream URL is never logged or
// returned to a browser. No catalog/customer playback state is changed.
const FROM=0,TO=4095;
const MAX_FILE_BYTES=4*1024*1024*1024;
const base={ok:false,providerMediaRequests:1,probeBytes:0,
  automaticDownload:false,stored:false,customerCutover:false};
export async function probePrivateEpisodeRange({
 url,fetchImpl,signal
}={}){
 if(typeof fetchImpl!=='function'||!url)return {...base,
  code:'episode_probe_input_invalid',providerMediaRequests:0};
 let response=null,reader=null;
 try{
  response=await fetchImpl(url,{
   method:'GET',redirect:'manual',
   headers:{range:'bytes=0-4095','accept-encoding':'identity',
    'user-agent':'BLOFY-ContentHub-EpisodeProbe/1.0'},
   signal:signal?AbortSignal.any([signal,AbortSignal.timeout(40000)]):
    AbortSignal.timeout(40000)
  });
  const match=/^bytes 0-4095\/([1-9][0-9]*)$/.exec(String(
   response?.headers?.get('content-range')||'').trim());
  const bytes=Number(match?.[1]);
  if(response.status!==206||!Number.isSafeInteger(bytes)||
    bytes<8192||bytes>MAX_FILE_BYTES||
    Number(response.headers.get('content-length'))!==4096||!response.body)
   return {...base,code:'episode_source_range_invalid'};
  reader=response.body.getReader();
  let received=0;
  while(received<4096){
   const next=await reader.read();
   if(next.done||!next.value||received+next.value.byteLength>4096)
    return {...base,code:'episode_source_range_short'};
   received+=next.value.byteLength;
  }
  const validator=String(response.headers.get('etag')||
   response.headers.get('last-modified')||'');
  return {...base,ok:true,code:'episode_4k_size_verified',
   probeBytes:4096,expectedBytes:bytes,
   validatorPresent:validator.length>0&&validator.length<=140&&
     !/[\r\n]/.test(validator)};
 }catch{return {...base,code:'episode_source_probe_unavailable'}}
 finally{
  if(reader){try{await reader.cancel()}catch{}
   try{reader.releaseLock()}catch{}}
  else if(response?.body){try{await response.body.cancel()}catch{}}
 }
}
