// Owner-initiated metadata suggestions. No playback/source/S3 requests, no
// auto-saving. TMDB queries are strictly gated on a separately confirmed
// commercial data/artwork license and a dedicated read access token.
const KEY=/^(?:movie:[A-Za-z0-9_-]{8,80}|series:[1-9][0-9]{0,14})$/;
const POSTER=/^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/;
const KINDS=new Set(['movie','series']);
const GENRE_BY_ID=new Map([
 [28,'action'],[12,'adventure'],[16,'animation'],[35,'comedy'],
 [80,'crime'],[99,'documentary'],[18,'drama'],[10751,'family'],
 [14,'fantasy'],[27,'horror'],[10749,'romance'],[878,'science_fiction'],
 [53,'thriller'],[10765,'science_fiction'],[10759,'action']
]);
const strip=text=>String(text||'').replace(/[\x00-\x1f\x7f<>]/g,'')
 .replace(/https?:\/\/\S+/gi,'').trim();
const safeTitle=text=>strip(text).slice(0,140);
const canonical=text=>safeTitle(text).normalize('NFKC')
 .toLocaleLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'')
 .replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
export function validateMatchRequest({key,query,year=null,language='ar-SA'}={}){
 if(typeof key!=='string'||!KEY.test(key)||
    typeof query!=='string'||query.trim().length<2||
    query.trim().length>100||/[\x00-\x1f\x7f<>]/.test(query)||
    /https?:\/\//i.test(query)||
    !(year===null||Number.isSafeInteger(year)&&year>=1888&&
     year<=new Date().getUTCFullYear()+2)||
    !['ar-SA','en-US'].includes(language))
  throw Error('metadata_match_invalid');
 return {key,kind:key.startsWith('movie:')?'movie':'series',
  query:query.trim(),year,language};
}
const yearFrom=value=>{
 if(typeof value!=='string'||!/^\d{4}(?:-|$)/.test(value))return null;
 const n=Number(value.slice(0,4));
 return Number.isSafeInteger(n)&&n>=1888&&n<=new Date().getUTCFullYear()+2?
  n:null;
};
export function scoreMetadataCandidate(query,title,year=null,releaseYear=null){
 const a=canonical(query),b=canonical(title);
 if(!a||!b)return 0;
 const ta=new Set(a.split(' ')),tb=new Set(b.split(' '));
 const matches=[...ta].filter(w=>tb.has(w)).length;
 let score=a===b?94:Math.floor(matches/Math.max(ta.size,tb.size)*78);
 if(a!==b&&(a.startsWith(b)||b.startsWith(a)))score=Math.max(score,70);
 if(year!==null&&releaseYear!==null)
  score+=year===releaseYear?6:Math.abs(year-releaseYear)>=3?-15:-5;
 return Math.max(0,Math.min(100,score));
}
export function normalizeTmdbCandidates(payload,{kind,query,year}){
 const rows=Array.isArray(payload?.results)?payload.results.slice(0,20):[];
 const candidates=rows.map(row=>{
  const id=Number(row?.id);
  const title=safeTitle(kind==='movie'?row.title:row.name);
  if(!Number.isSafeInteger(id)||id<1||!title)return null;
  const releaseYear=yearFrom(kind==='movie'?row.release_date:row.first_air_date);
  const poster=String(row.poster_path||'');
  const genre=Array.isArray(row.genre_ids)?
   row.genre_ids.map(x=>GENRE_BY_ID.get(x)).find(Boolean)||'unspecified':
   'unspecified';
  return {tmdbId:id,kind,title,originalTitle:safeTitle(
   kind==='movie'?row.original_title:row.original_name),
   year:releaseYear,genre,overview:strip(row.overview).slice(0,700),
   posterPath:POSTER.test(poster)?poster:null,
   confidence:scoreMetadataCandidate(query,title,year,releaseYear),
   source:'tmdb',readOnly:true,autoSelected:false,
   licenseVerifiedByUser:false};
 }).filter(Boolean);
 candidates.sort((a,b)=>b.confidence-a.confidence||
  a.tmdbId-b.tmdbId);
 return candidates.slice(0,8);
}
// Conservative name hints from *stored* episode headings, not a source
// catalog. Strip common episode/codec markers, reject likely credential
// strings, group repeated candidates; never call a suggestion "verified".
export function deriveEpisodeTitleHints(titles=[]){
 const counts=new Map();
 const digits=s=>s.replace(/[\u0660-\u0669\u06f0-\u06f9]/g,ch=>{
  const v=ch.charCodeAt(0);
  return String(v>=0x6f0?v-0x6f0:v-0x660);
 });
 const marker=/(?:^|[\s\-:])(?:s[ ._-]?\d{1,2}[ ._-]*e[ ._-]?\d{1,3}|\d{1,2}x\d{1,3}|season\s*\d{1,2}(?:\s*episode\s*\d{1,3})?|episode\s*\d{1,3}|ep\s*\d{1,3}|الموسم\s*\d{1,2}(?:\s*الحلقة\s*\d{1,3})?|الحلقة\s*\d{1,3})(?=$|[\s\-:_.])/i;
 for(const raw of Array.isArray(titles)?titles.slice(0,25):[]){
  if(typeof raw!=='string'||raw.length>250||
     /(?:user(?:name)?|pass(?:word)?|token|api[_ -]?key|secret|auth)\s*[=:]/i.test(raw))
   continue;
  let name=digits(strip(raw))
   .replace(/\.(?:mkv|mp4|avi|ts|mov|m3u8)$/i,'')
   .replace(/\[(?:720p|1080p|2160p|4k|webrip|web.?dl|bluray|x26[45]|h\.?264|hevc)\]/gi,' ')
   .replace(/[._]+/g,' ').replace(/\s+/g,' ').trim();
  const hit=marker.exec(name);
  if(hit){
   // A title beginning with "episode 1" could be an *episode title*
   // itself. Reject it rather than guessing the series from its suffix.
   if(hit.index===0)continue;
   name=name.slice(0,hit.index);
  }
  name=name.replace(/\b(?:720p|1080p|2160p|4k|webrip|web.?dl|bluray|x26[45]|h264|hevc)\b/gi,' ')
   .replace(/[\s\-–:()\[\],]+$/g,'').replace(/^[\s\-–:()\[\],]+/g,'')
   .replace(/\s+/g,' ').trim();
  if(name.length<3||name.length>100||
     /^(?:episode|season|ep|الحلقة|الموسم|الجزء|test|sample)\s*\d*$/i.test(name)||
     !/[\p{L}]/u.test(name))continue;
  const normalized=canonical(name);
  if(!normalized)continue;
  const found=counts.get(normalized)||{title:name,count:0};
  if(name.length<found.title.length)found.title=name;
  found.count++;counts.set(normalized,found);
 }
 return [...counts.values()].sort((a,b)=>b.count-a.count||
  a.title.localeCompare(b.title)).slice(0,5).map(x=>({
   title:x.title,count:x.count,source:'saved_episode_title',
   confidenceLabel:x.count>=2?'repeated_saved_heading':'single_saved_heading',
   manualReviewOnly:true,verifiedTitle:false,autoSelected:false
  }));
}

export function createMetadataMatcher({
 token='',commercialLicenseConfirmed=false,fetchImpl=globalThis.fetch,
 now=()=>Date.now()
}={}){
 const enabled=Boolean(commercialLicenseConfirmed)&&
  typeof token==='string'&&token.length>=24;
 let lastRequestAt=0;
 const cache=new Map();
 return {
  enabled,
  async suggest(input){
   const item=validateMatchRequest(input);
   if(!enabled)return {ok:true,configured:false,
    code:'tmdb_commercial_license_and_token_required',candidates:[],
    automaticSave:false,providerMediaRequests:0,storageRequests:0,
    tmdbRequests:0,requiresOwnerReview:true};
   const cacheKey=[item.kind,item.query.toLocaleLowerCase(),
    item.year??'',item.language].join('|');
   const cached=cache.get(cacheKey),time=now();
   if(cached&&cached.expiresAt>time)
    return {...cached.result,cacheHit:true,tmdbRequests:0};
   if(time-lastRequestAt<1700)return {ok:false,
    code:'tmdb_owner_search_rate_limited',candidates:[],
    automaticSave:false,tmdbRequests:0};
   lastRequestAt=time;
   const url=new URL('https://api.themoviedb.org/3/search/'+
    (item.kind==='movie'?'movie':'tv'));
   url.searchParams.set('query',item.query);
   url.searchParams.set('language',item.language);
   url.searchParams.set('include_adult','false');
   url.searchParams.set('page','1');
   if(item.year!==null)url.searchParams.set(
    item.kind==='movie'?'year':'first_air_date_year',String(item.year));
   let payload;
   try{
    const res=await fetchImpl(url.toString(),{
     method:'GET',redirect:'error',
     headers:{authorization:'Bearer '+token,accept:'application/json'},
     signal:AbortSignal.timeout(6000)
    });
    if(!res?.ok||Number(res.headers?.get?.('content-length')||0)>500000)
     return {ok:false,code:'tmdb_lookup_unavailable',candidates:[],
      automaticSave:false,tmdbRequests:1};
    payload=await res.json();
   }catch{
    return {ok:false,code:'tmdb_lookup_unavailable',
     candidates:[],automaticSave:false,tmdbRequests:1};
   }
   const result={ok:true,configured:true,
    candidates:normalizeTmdbCandidates(payload,item),
    source:'tmdb',readOnly:true,automaticSave:false,
    providerMediaRequests:0,storageRequests:0,tmdbRequests:1,
    requiresOwnerReview:true,attribution:
     'This product uses the TMDB API but is not endorsed or certified by TMDB.'};
   if(cache.size>=25)cache.delete(cache.keys().next().value);
   cache.set(cacheKey,{expiresAt:time+10*60*1000,result});
   return result;
  }
 };
}
