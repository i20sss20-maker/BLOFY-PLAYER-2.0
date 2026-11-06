// Safe, bounded streaming index of an explicitly linked authorized Xtream M3U.
// Never store a playlist, unencrypted stream URL, or its query credentials.
// Only exact, same-account media IDs are candidates for playback recovery.
const MEDIA_TYPES=new Set(['movie','series']);
const MEDIA_EXT=/^(?:mp4|mkv|ts|m3u8|avi|mov|webm|flv|wmv)$/i;
const MEDIA_ID=/^[A-Za-z0-9_-]{1,128}$/;

export function parseHybridM3uMediaUrl(raw,{baseUrl,username,password}={}){
  if(typeof raw!=='string'||!raw||raw.length>8192||/[\x00-\x1f\x7f\\]/.test(raw)||
     !/^https?:\/\//i.test(raw.trim()))return null;
  let url,base;
  try{url=new URL(raw.trim());base=new URL(baseUrl)}catch{return null}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||
     url.hostname==='localhost'||url.hostname.endsWith('.localhost')||
     url.hostname.endsWith('.local'))return null;
  if(url.protocol==='http:'&&url.origin!==base.origin)return null;
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts.length!==4||!MEDIA_TYPES.has(parts[0]))return null;
  let listedUser,listedPass,resource;
  try{
    listedUser=decodeURIComponent(parts[1]);
    listedPass=decodeURIComponent(parts[2]);
    resource=decodeURIComponent(parts[3]);
  }catch{return null}
  // Never combine accounts from a shared playlist or a second IPTV service.
  if(listedUser!==String(username??'')||listedPass!==String(password??''))return null;
  const match=/^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{2,8})$/.exec(resource);
  if(!match||!MEDIA_ID.test(match[1])||!MEDIA_EXT.test(match[2]))return null;
  return {kind:parts[0],sourceId:match[1],extension:match[2].toLowerCase(),url:url.toString()};
}

export async function scanHybridM3uMedia(readable,{baseUrl,username,password,onBatch,
  maxBytes=192*1024*1024,maxEntries=600000,batchSize=300}={}){
  if(!readable||typeof readable.getReader!=='function'||typeof onBatch!=='function')
    throw new Error('xtream_hybrid_scan_invalid');
  const reader=readable.getReader(),decoder=new TextDecoder('utf-8');
  let carry='',bytes=0,entries=0,matched=0,films=0,episodes=0,hasHeader=false,
      afterInfo=false,batch=[],lineCount=0;
  const flush=async()=>{
    if(!batch.length)return;
    const rows=batch;batch=[];
    await onBatch(rows);
  };
  const processLine=async raw=>{
    const line=raw.trim().replace(/^\uFEFF/,'');
    if(!hasHeader){
      if(!line)return;
      if(!line.startsWith('#EXTM3U')||line.length>8192)
        throw new Error('xtream_m3u_invalid_header');
      hasHeader=true;return;
    }
    if(line.startsWith('#EXTINF:')){afterInfo=true;return;}
    if(!line||line.startsWith('#'))return;
    if(!afterInfo)return;
    afterInfo=false;
    if(++entries>maxEntries)throw new Error('xtream_m3u_too_many_items');
    const candidate=parseHybridM3uMediaUrl(line,{baseUrl,username,password});
    if(!candidate)return;
    batch.push(candidate);
    matched++;
    if(candidate.kind==='movie')films++;
    else episodes++;
    if(batch.length>=batchSize)await flush();
  };
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value?.byteLength||0;
      if(bytes>maxBytes)throw new Error('xtream_m3u_too_large');
      carry+=decoder.decode(value,{stream:true});
      let end;
      while((end=carry.indexOf('\n'))>=0){
        const line=carry.slice(0,end);
        carry=carry.slice(end+1);
        if(++lineCount>maxEntries*5)throw new Error('xtream_m3u_too_many_lines');
        await processLine(line);
      }
      if(carry.length>32768)throw new Error('xtream_m3u_line_too_long');
    }
    carry+=decoder.decode();
    if(carry)await processLine(carry);
    if(!hasHeader)throw new Error('xtream_m3u_invalid_header');
    await flush();
    return {bytes,entries,matched,movies:films,episodes};
  }finally{
    try{await reader.cancel()}catch{}
    try{reader.releaseLock()}catch{}
  }
}

// A DB-backed index is valid only for the exact source and live generation.
// Refuse links marked ambiguous by multiple distinct media URLs for one ID.
export function verifiedHybridRow(row,expectedGeneration){
  if(!row||row.ambiguous||!row.stream_url_secret||
     String(row.generation)!==String(expectedGeneration))return false;
  return true;
}
