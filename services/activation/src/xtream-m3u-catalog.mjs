// Licensed Xtream feeds sometimes implement player_api.php authentication but
// not the category/list actions. Fall back to their own GET.php M3U export,
// without probing unrelated endpoints or bypassing per-account limits.
import crypto from 'node:crypto';
import {assertPublicXtreamUrl,xtreamM3uUrl} from './xtream-core.mjs';

const title = value => String(value||'').trim().slice(0,500);
const attributes = line => {
  const result={};
  for(const match of line.matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/gi)) result[match[1].toLowerCase()]=match[2];
  return result;
};
const groupId = (kind, name) => 'm3u-'+crypto.createHash('sha256').update(kind+'\x00'+name).digest('hex').slice(0,24);

export function parseXtreamM3uCatalog(content,{baseUrl,username,password,maxItems=60000}={}){
  const playlist=String(content||'');
  if(!playlist.trimStart().startsWith('#EXTM3U'))throw new Error('xtream_m3u_invalid_header');
  const upstream=new URL(baseUrl);
  const origin=upstream.origin;
  const prefix=upstream.pathname.split('/').filter(Boolean);
  const records={live:[],movie:[],series:[]};
  const categories={live:new Map(),movie:new Map(),series:new Map()};
  // Reuse each category hash instead of repeating SHA-256 for every channel.
  // IPTV feeds routinely contain tens of thousands of entries sharing a group.
  const categoryIds=new Map();
  let info=null,accepted=0;
  // Walk the original text without allocating a second huge array of lines.
  // This keeps peak memory lower for permitted 48 MiB M3U exports.
  for(let pos=0;pos<playlist.length;){
    const newline=playlist.indexOf('\n',pos);
    const end=newline===-1?playlist.length:newline;
    const line=playlist.slice(pos,end).trim();
    pos=newline===-1?playlist.length:newline+1;
    if(line.startsWith('#EXTINF:')){
      const comma=line.indexOf(',');
      info=comma<0?null:{name:title(line.slice(comma+1)),attrs:attributes(line.slice(0,comma))};
      continue;
    }
    if(!line||line.startsWith('#')||!info)continue;
    const current=info;info=null;
    if(!current.name)continue;
    let url;
    try{url=new URL(line)}catch{continue}
    if(url.origin!==origin||url.search||url.hash||url.username||url.password)continue;
    // Xtream exports may contain /panel/live/... instead of /live/... .
    // Accept only the configured prefix or the historical root form.
    let paths=url.pathname.split('/').filter(Boolean);
    if(prefix.length&&prefix.every((segment,i)=>paths[i]===segment))
      paths=paths.slice(prefix.length);
    let kind,user,pass,resource;
    if(paths.length===4&&['live','movie','series'].includes(paths[0])){
      [kind,user,pass,resource]=paths;
    }else if(paths.length===3){
      [user,pass,resource]=paths;kind='live';
    }else continue;
    try{user=decodeURIComponent(user);pass=decodeURIComponent(pass);resource=decodeURIComponent(resource)}catch{continue}
    if(user!==username||pass!==password)continue;
    const match=/^([A-Za-z0-9_-]{1,128})\.([a-z0-9]{2,8})$/i.exec(resource);
    if(!match)continue;
    const extension=match[2].toLowerCase();
    if(paths.length===3&&['mp4','mkv','mov','avi','webm'].includes(extension))kind='movie';
    // Episodes in an M3U list are NOT a get_series item; importing them as
    // series IDs would break get_series_info. Keep the source's series API authoritative.
    if(kind==='series')continue;
    const category=title(current.attrs['group-title']||'Other').slice(0,300)||'Other';
    const groupKey=kind+'\x00'+category;
    let categoryId=categoryIds.get(groupKey);
    if(!categoryId){
      categoryId=groupId(kind,category);
      categoryIds.set(groupKey,categoryId);
      categories[kind].set(categoryId,{sourceCategoryId:categoryId,name:category,parentId:null});
    }
    records[kind].push({
      sourceId:match[1],categoryId,name:current.name,
      iconUrl:String(current.attrs['tvg-logo']||'').slice(0,2048)||null,
      containerExtension:extension,
      metadata:{epgChannelId:String(current.attrs['tvg-id']||'').slice(0,256),genre:category}
    });
    accepted++;
    if(accepted>=maxItems)break;
  }
  return {records,categories:Object.fromEntries(Object.entries(categories).map(([kind,map])=>[kind,[...map.values()]]))};
}

// Stream the official M3U and retain only live/movie entries. Source 2's
// original M3U is larger than 80 MiB mainly because it also enumerates
// hundreds of thousands of SERIES EPISODES, which must NOT be imported as
// get_series_info series. Do not buffer the entire provider response in RAM.
// Keep the existing, tested parseXtreamM3uCatalog semantics for retained rows.
export async function downloadXtreamM3uCatalog({baseUrl,username,password},{
 maxBytes=128*1024*1024,maxRetainedBytes=48*1024*1024,
 timeoutMs=115000,fetchImpl=fetch,independentImpl=null,
 checkPublic=assertPublicXtreamUrl
}={}){
 const url=xtreamM3uUrl(baseUrl,username,password);
 // Never turn an upstream 401/403/404/456 into a fallback/bypass. Only a
 // genuine transport exception may switch to the protected source-pinned
 // Railway M3U relay, which retains the same official get.php URL.
 await checkPublic(url.origin);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 let response;
 try{
  try{
   response=await fetchImpl(url,{redirect:'error',signal:controller.signal,
    headers:{accept:'audio/x-mpegurl,text/plain,*/*','user-agent':'BLOFY-Xtream/1.0'}});
  }catch(error){
   if(controller.signal.aborted)throw new Error('xtream_m3u_timeout');
   if(typeof independentImpl!=='function')
    throw new Error('xtream_m3u_unavailable');
   try{response=await independentImpl(url,{timeoutMs});}
   catch{throw new Error('xtream_m3u_unavailable');}
  }
  if(!response.ok){
   await response.body?.cancel().catch(()=>{});
   throw new Error('xtream_m3u_http_'+response.status);
  }
  if(/text\/html/i.test(response.headers.get('content-type')||'')){
   await response.body?.cancel().catch(()=>{});
   throw new Error('xtream_m3u_not_playlist');
  }
  if(!response.body)throw new Error('xtream_m3u_empty');
  const origin=new URL(baseUrl).origin;
  const prefix=new URL(baseUrl).pathname.split('/').filter(Boolean);
  const retained=['#EXTM3U'];
  let bytes=0,retainedBytes=8,partial='',header=false,pendingInf=null;
  const decoder=new TextDecoder('utf-8');
  const consume=line=>{
   const s=line.trim();
   if(!header){
    if(!s)return;
    if(!s.replace(/^\uFEFF/,'').startsWith('#EXTM3U'))
     throw new Error('xtream_m3u_invalid_header');
    header=true;return;
   }
   if(s.startsWith('#EXTINF:')){pendingInf=s;return;}
   if(!s||s.startsWith('#'))return;
   const info=pendingInf;pendingInf=null;
   if(!info)return;
   let link;
   try{link=new URL(s);}catch{return;}
   if(link.origin!==origin||link.search||link.hash||link.username||link.password)return;
   let parts=link.pathname.split('/').filter(Boolean);
   if(prefix.length&&prefix.every((p,i)=>parts[i]===p))
    parts=parts.slice(prefix.length);
   if(parts.length===4){
    if(parts[0]!=='live'&&parts[0]!=='movie')return;
   }else if(parts.length!==3)return;
   // The normal parser is authoritative for exact user/password/extension,
   // category and item checks. The prefilter only avoids storing episodes.
   try{
    if(decodeURIComponent(parts.at(-3))!==username||
       decodeURIComponent(parts.at(-2))!==password)return;
   }catch{return;}
   retainedBytes+=Buffer.byteLength(info)+Buffer.byteLength(s)+2;
   if(retainedBytes>maxRetainedBytes)throw new Error('xtream_m3u_retained_too_large');
   retained.push(info,s);
  };
  try{
   for await(const chunk of response.body){
    bytes+=chunk.byteLength||chunk.length||0;
    if(bytes>maxBytes)throw new Error('xtream_m3u_too_large');
    partial+=decoder.decode(chunk,{stream:true});
    let end;
    while((end=partial.indexOf('\n'))>=0){
     consume(partial.slice(0,end));
     partial=partial.slice(end+1);
    }
    if(partial.length>16384)throw new Error('xtream_m3u_line_too_large');
   }
   partial+=decoder.decode();
   if(partial)consume(partial);
   if(!header)throw new Error('xtream_m3u_invalid_header');
  }catch(error){
   await response.body?.cancel().catch(()=>{});
   throw error;
  }
  // The provider lists ~79k movie/live URLs (including duplicates), not
  // just 34k unique IDs. Do not cut the official export after 60k rows;
  // the downstream import deduplicates source IDs per media type.
  return parseXtreamM3uCatalog(retained.join('\n'),{
   baseUrl,username,password,maxItems:120000
  });
 }finally{
  clearTimeout(timer);
  controller.abort();
 }
}
