// Bounded, owner-only catalog curation diagnostics for the *visible page*.
// Never infer a full media library or a licensed artwork entitlement.
const MOVIE=/^movie:([A-Za-z0-9_-]{8,80})$/;
const SERIES=/^series:([1-9][0-9]{0,14})$/;
const SEASON=/^series_([1-9][0-9]{0,14})_s[0-9]{1,3}$/;
const safeTitle=x=>typeof x==='string'?x.trim().slice(0,140)
 .replace(/[<>\x00-\x1f\x7f]/g,''):null;
const isPoster=x=>typeof x==='string'&&
 /^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/.test(x);
export function buildMetadataReview({movies=[],seasons=[],
 moviesSampleLimited=false,seasonsHasMore=false,page=1}={}){
 const list=[],ids=new Set();
 function add(key,mediaKind,metadata,seasonKey=null){
  if((mediaKind==='movie'&&!MOVIE.test(key))||
     (mediaKind==='series'&&!SERIES.test(key))||ids.has(key))return;
  ids.add(key);
  const title=safeTitle(metadata?.title);
  const hasTitle=Boolean(title&&title.length>=2);
  const hasPoster=isPoster(metadata?.posterPath);
  const missingTitle=!hasTitle,missingPoster=!hasPoster;
  const year=Number.isInteger(metadata?.year)?metadata.year:null;
  const genre=typeof metadata?.genre==='string'?
   metadata.genre:'unspecified';
  const detailsIncomplete=year===null||genre==='unspecified'||
    !String(metadata?.overview||'').trim();
  list.push({key,kind:mediaKind,
   title:hasTitle?title:null,
   seasonKey,hasTitle,hasPoster,
   missingTitle,missingPoster,detailsIncomplete,
   status:missingTitle?'needs_title':
    missingPoster?'optional_artwork_review':
    detailsIncomplete?'optional_details_review':'fully_described',
   manualReviewOnly:true,automaticallyMatched:false,
   rightsUnverifiedUntilOwnerConfirms:true});
 }
 for(const movie of Array.isArray(movies)?movies.slice(0,50):[]){
  const key='movie:'+String(movie?.runId||'');
  add(key,'movie',movie?.metadata||null);
 }
 for(const season of Array.isArray(seasons)?seasons.slice(0,50):[]){
  const match=SEASON.exec(String(season?.seasonKey||''));
  if(!match)continue;
  add('series:'+match[1],'series',season?.metadata||null,
   season.seasonKey);
 }
 const counts={movies:list.filter(x=>x.kind==='movie').length,
  series:list.filter(x=>x.kind==='series').length,
  titled:list.filter(x=>x.hasTitle).length,
  missingTitle:list.filter(x=>x.missingTitle).length,
  withPoster:list.filter(x=>x.hasPoster).length,
  missingPoster:list.filter(x=>x.missingPoster).length,
  fullyDescribed:list.filter(x=>x.status==='fully_described').length};
 const priority={needs_title:0,optional_artwork_review:1,
  optional_details_review:2,fully_described:3};
 list.sort((a,b)=>priority[a.status]-priority[b.status]||
  a.kind.localeCompare(b.kind)||a.key.localeCompare(b.key));
 return {ok:true,readOnly:true,sampleOnly:true,
  scope:'visible_search_page_registered_movie_and_series_items',
  page:Number.isSafeInteger(page)&&page>0?page:1,
  pageSizeForEachCategory:40,
  globalCoverageKnown:false,
  moviesSampleLimited:moviesSampleLimited===true,
  seasonsHasMore:seasonsHasMore===true,
  counts,
  reviewItems:list.filter(x=>x.status!=='fully_described').slice(0,16),
  reviewItemsLimited:list.filter(x=>x.status!=='fully_described').length>16,
  noAutomaticChanges:true,providerMediaRequests:0,
  tmdbRequests:0,storageRequests:0};
}
