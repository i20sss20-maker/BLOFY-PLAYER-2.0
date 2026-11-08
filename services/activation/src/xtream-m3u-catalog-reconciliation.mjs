// Read-only reconciliation: compare EVERY locally imported live/movie ID
// with the provider's official M3U export (one bounded HTTP request).
// Stream the playlist; do NOT index it, follow media URLs or fetch videos.
import {assertPublicXtreamUrl,normalizeXtreamBaseUrl,xtreamM3uUrl} from './xtream-core.mjs';
import {getXtreamManifestHttp11} from './xtream-m3u-http11.mjs';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EXT=/^[a-z0-9]{2,8}$/i;
export async function reconcileXtreamM3uWithImportedCatalog({
  pool,sourceId,baseUrl,username,password
},{fetchImpl=fetch,http11Impl=getXtreamManifestHttp11,
  independentImpl=null,checkPublic=assertPublicXtreamUrl,
  maxBytes=64*1024*1024,timeoutMs=90000}={}){
 let stage='base_url';
 try{
 const origin=new URL(normalizeXtreamBaseUrl(baseUrl));
 stage='public_dns';
 await checkPublic(origin.origin);
 stage='database';
 const rows=(await pool.query(`SELECT media_type,source_id,container_extension
   FROM blofy_xtream_items WHERE server_id=$1 AND enabled=TRUE
     AND media_type IN ('live','movie')`,[sourceId])).rows;
 const imported={live:new Map(),movie:new Map()};
 for(const row of rows){
  if(imported[row.media_type]&&ID.test(String(row.source_id||'')))
   imported[row.media_type].set(String(row.source_id),
     String(row.container_extension||'').replace(/^\./,'').toLowerCase());
 }
 stage='playlist_request';
 const url=xtreamM3uUrl(baseUrl,username,password);
 let response,transport='fetch';
 try{
  response=await fetchImpl(url,{
   redirect:'manual',signal:AbortSignal.timeout(timeoutMs),
   headers:{accept:'audio/x-mpegurl,text/plain,*/*',
     'user-agent':'BLOFY-Xtream-Audit/1.0'}
  });
 }catch{
  stage='playlist_http11_request';
  // Only a transport exception permits trying a different connection path.
  try{
   response=await http11Impl(url,{signal:AbortSignal.timeout(timeoutMs)});
   transport='http11';
  }catch{
   if(typeof independentImpl!=='function')throw Error('manifest_independent_disabled');
   stage='playlist_independent_request';
   response=await independentImpl(url,{timeoutMs});
   transport='isolated_stream';
  }
 }
 if(response.status!==200||!response.body){
   await response.body?.cancel().catch(()=>{});
   return {ok:false,code:'m3u_http_unavailable',
     playlistStatus:response.status,transport,mediaRequests:0};
 }
 stage='playlist_read';
 const found={live:new Set(),movie:new Set()},mismatch=new Set();
 const counts={movieUrls:0,liveUrls:0,seriesEpisodeUrls:0,
   extraMovieUrls:0,extraLiveUrls:0,ignoredUrls:0};
 const prefix=origin.pathname.split('/').filter(Boolean);
 let bytes=0,lineCount=0,firstNonempty=false,headerOk=false,partial='',incomplete=false;
 const handle=line=>{
  const s=line.trim();
  if(!s)return;
  if(!firstNonempty){firstNonempty=true;headerOk=s.replace(/^\uFEFF/,'')==='#EXTM3U';return;}
  if(s.startsWith('#'))return;
  if(lineCount++>=350000){incomplete=true;return;}
  if(s.length>4000){counts.ignoredUrls++;return;}
  let link;
  try{link=new URL(s)}catch{counts.ignoredUrls++;return}
  if(link.origin!==origin.origin||link.username||link.password||
     link.search||link.hash){counts.ignoredUrls++;return;}
  let parts=link.pathname.split('/').filter(Boolean);
  if(prefix.length&&prefix.every((p,i)=>parts[i]===p))parts=parts.slice(prefix.length);
  let kind,user,pass,resource;
  if(parts.length===4&&['live','movie','series'].includes(parts[0]))
   [kind,user,pass,resource]=parts;
  else if(parts.length===3){[user,pass,resource]=parts;kind='live';}
  else{counts.ignoredUrls++;return;}
  try{user=decodeURIComponent(user);pass=decodeURIComponent(pass);
    resource=decodeURIComponent(resource)}
  catch{counts.ignoredUrls++;return;}
  if(user!==username||pass!==password){counts.ignoredUrls++;return;}
  const match=/^([A-Za-z0-9_-]{1,128})\.([a-z0-9]{2,8})$/i.exec(resource);
  if(!match||!EXT.test(match[2])){counts.ignoredUrls++;return;}
  const id=match[1],ext=match[2].toLowerCase();
  if(parts.length===3&&['mp4','mkv','avi','mov','webm'].includes(ext))kind='movie';
  if(kind==='series'){counts.seriesEpisodeUrls++;return;}
  if(!imported[kind])return;
  counts[kind+'Urls']++;
  if(!imported[kind].has(id)){counts[kind==='live'?'extraLiveUrls':'extraMovieUrls']++;return;}
  found[kind].add(id);
  if(kind==='movie'&&imported.movie.get(id)&&imported.movie.get(id)!==ext)
   mismatch.add(id);
 };
 try{
  for await(const chunk of response.body){
   bytes+=chunk.byteLength||chunk.length||0;
   if(bytes>maxBytes){incomplete=true;break;}
   partial+=new TextDecoder().decode(chunk);
   let end;
   while((end=partial.indexOf('\n'))>=0){
    const line=partial.slice(0,end);partial=partial.slice(end+1);
    handle(line);
    if(incomplete)break;
   }
   if(partial.length>8192||incomplete){incomplete=true;break;}
  }
  if(partial&&!incomplete)handle(partial);
 }finally{if(!response.bodyUsed)await response.body.cancel().catch(()=>{});}
 const missingByType=type=>Math.max(0,imported[type].size-found[type].size);
 return {ok:headerOk&&!incomplete,readOnly:true,
   playlistHeaderValid:headerOk,incomplete,playlistStatus:response.status,transport,
   playlistBytesRead:bytes,importedLive:imported.live.size,
   importedMovies:imported.movie.size,
   matchedLive:found.live.size,matchedMovies:found.movie.size,
   liveMissingFromPlaylist:missingByType('live'),
   moviesMissingFromPlaylist:missingByType('movie'),
   movieExtensionsDisagreeing:mismatch.size,
   ...counts,mediaRequests:0,
   note:'Playlist matching is evidence of ID/extension differences, not proof of media playback.'};
 }catch{
  // Never emit an exception message: Node fetch errors may contain a full
  // signed playlist URL or credentials. Only a fixed stage name is emitted.
  return {ok:false,code:'reconciliation_stage_failed',stage,
    readOnly:true,mediaRequests:0,credentialsLogged:false};
 }
}
