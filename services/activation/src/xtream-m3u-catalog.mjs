// Licensed Xtream feeds sometimes implement player_api.php authentication but
// not the category/list actions. Fall back to their own GET.php M3U export,
// without probing unrelated endpoints or bypassing per-account limits.
import crypto from 'node:crypto';

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
  const origin=new URL(baseUrl).origin;
  const records={live:[],movie:[],series:[]};
  const categories={live:new Map(),movie:new Map(),series:new Map()};
  let info=null,accepted=0;
  for(const raw of playlist.split(/\r?\n/)){
    const line=raw.trim();
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
    const paths=url.pathname.split('/').filter(Boolean);
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
    const categoryId=groupId(kind,category);
    categories[kind].set(categoryId,{sourceCategoryId:categoryId,name:category,parentId:null});
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

export async function downloadXtreamM3uCatalog({baseUrl,username,password},{maxBytes=48*1024*1024,timeoutMs=90000}={}){
  const host=new URL(baseUrl);
  const url=new URL('/get.php',host);
  url.searchParams.set('username',username);
  url.searchParams.set('password',password);
  url.searchParams.set('type','m3u_plus');
  url.searchParams.set('output','ts');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let response;
    try{
      response=await fetch(url,{redirect:'error',signal:controller.signal,
        headers:{accept:'audio/x-mpegurl,text/plain,*/*','user-agent':'BLOFY-Xtream/1.0'}});
    }catch(error){
      throw new Error(error.name==='AbortError'?'xtream_m3u_timeout':'xtream_m3u_unavailable');
    }
    if(!response.ok)throw new Error('xtream_m3u_http_'+response.status);
    if(/text\/html/i.test(response.headers.get('content-type')||''))throw new Error('xtream_m3u_not_playlist');
    const pieces=[];let bytes=0;
    for await(const piece of response.body){
      bytes+=piece.length;
      if(bytes>maxBytes){controller.abort();throw new Error('xtream_m3u_too_large');}
      pieces.push(piece);
    }
    return parseXtreamM3uCatalog(Buffer.concat(pieces).toString('utf8'),{
      baseUrl,username,password
    });
  }finally{clearTimeout(timer);}
}
