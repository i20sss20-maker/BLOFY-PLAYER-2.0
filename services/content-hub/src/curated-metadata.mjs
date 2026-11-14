// Owner-curated private catalog labels. Never scrapes a provider, TMDb,
// object storage or a subscriber-facing catalog. Poster references are only
// manually supplied TMDb image *paths*, not arbitrary remote URLs.
import pg from 'pg';

const MOVIE=/^movie:([A-Za-z0-9_-]{8,80})$/;
const SERIES=/^series:([1-9][0-9]{0,14})$/;
const POSTER=/^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/;
const GENRES=new Set(['unspecified','drama','action','comedy','thriller',
 'romance','family','animation','documentary','horror','science_fiction',
 'fantasy','crime','adventure','other']);
const META_KEYS=150;
const safeCode=x=>typeof x==='string'&&(MOVIE.test(x)||SERIES.test(x));
export function validateCuratedMetadata(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    typeof input.key!=='string'||!safeCode(input.key)||
    typeof input.title!=='string'||input.title.trim().length<2||
    input.title.trim().length>140||/[\x00-\x1f\x7f<>]/.test(input.title)||
    typeof input.overview!=='string'||input.overview.length>700||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(input.overview)||
    typeof input.genre!=='string'||!GENRES.has(input.genre)||
    !(input.year===null||Number.isSafeInteger(input.year)&&
       input.year>=1888&&input.year<=new Date().getUTCFullYear()+2)||
    !(input.posterPath===null||typeof input.posterPath==='string'&&
       POSTER.test(input.posterPath))||
    input.confirmed!==true||input.artworkRightsConfirmed!==true)
  throw Error('curated_metadata_invalid');
 return {key:input.key,title:input.title.trim(),
  year:input.year,genre:input.genre,
  overview:input.overview.trim(),posterPath:input.posterPath};
}
const toItem=row=>({
 key:row.media_key,title:row.title,year:row.release_year,
 genre:row.genre,overview:row.overview,
 posterPath:row.poster_path,updatedAt:row.updated_at,
 source:'owner_curated',artworkRightsConfirmed:true
});
export function createContentCatalogStore({connectionString,Pool=pg.Pool}={}){
 if(!connectionString)throw Error('content_catalog_database_required');
 const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:'blofy-private-catalog'});
 let initPromise;
 function ensure(){
  if(!initPromise){
   initPromise=pool.query([
    'CREATE TABLE IF NOT EXISTS blofy_content_hub_curated_metadata (',
    'media_key TEXT PRIMARY KEY,title TEXT NOT NULL,',
    'release_year INTEGER,genre TEXT NOT NULL,overview TEXT NOT NULL,',
    'poster_path TEXT,artwork_rights_confirmed BOOLEAN NOT NULL DEFAULT TRUE,',
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
   ].join(' ')).catch(e=>{initPromise=null;throw e});
  }
  return initPromise;
 }
 async function persisted(key){
  const movie=MOVIE.exec(key),series=SERIES.exec(key);
  if(movie){
   for(const table of ['blofy_content_hub_pilot_runs',
     'blofy_content_hub_chunk_runs']){
    const q=await pool.query('SELECT 1 FROM '+table+
     ' WHERE run_id=$1 LIMIT 1',[movie[1]]).catch(e=>{
      if(e?.code==='42P01')return {rows:[]};
      throw e;
     });
    if(q.rows?.length)return true;
   }
   return false;
  }
  if(series){
   const q=await pool.query([
    'SELECT 1 FROM blofy_content_hub_season_queue',
    "WHERE regexp_replace(season_key,'_s[0-9]+$','')=$1 LIMIT 1"
   ].join(' '),['series_'+series[1]]).catch(e=>{
    if(e?.code==='42P01')return {rows:[]};
    throw e;
   });
   return q.rows?.length>0;
  }
  return false;
 }
 return {
  async hasRegisteredKey(key){
   if(!safeCode(key))return false;
   return persisted(key);
  },
  // Hint names come exclusively from stored episode queue titles.
  // None of these is a verified series title.
  async episodeTitleHints(key){
   const series=SERIES.exec(String(key||''));
   if(!series)return [];
   const q=await pool.query([
    'SELECT title FROM blofy_content_hub_season_queue',
    "WHERE regexp_replace(season_key,'_s[0-9]+$','')=$1",
    'ORDER BY updated_at DESC LIMIT 25'
   ].join(' '),['series_'+series[1]]).catch(error=>{
    if(error?.code==='42P01')return {rows:[]};
    throw error;
   });
   return (q.rows||[]).map(row=>String(row.title||''));
  },
  async find(keys=[]){
   if(!Array.isArray(keys)||keys.length>META_KEYS||
      keys.some(x=>!safeCode(x)))throw Error('catalog_keys_invalid');
   if(!keys.length)return [];
   const unique=[...new Set(keys)];
   const rows=await pool.query([
    'SELECT media_key,title,release_year,genre,overview,poster_path,updated_at',
    'FROM blofy_content_hub_curated_metadata WHERE media_key=ANY($1::text[])',
    'ORDER BY media_key LIMIT $2'
   ].join(' '),[unique,META_KEYS]).catch(e=>{
    if(e?.code==='42P01')return {rows:[]};
    throw e;
   });
   return (rows.rows||[]).map(toItem);
  },
  async searchSeriesIds(query,{limit=120}={}){
   if(typeof query!=='string'||query.length>80||
      /[\x00-\x1f\x7f]/.test(query))throw Error('catalog_search_invalid');
   if(!query.trim())return {ids:[],limited:false};
   const n=Math.min(120,Math.max(1,Math.floor(Number(limit)||120)));
   const r=await pool.query([
    'SELECT media_key FROM blofy_content_hub_curated_metadata',
    "WHERE media_key LIKE 'series:%' AND",
    'POSITION(LOWER($1) IN LOWER(title))>0',
    'ORDER BY media_key LIMIT $2'
   ].join(' '),[query.trim(),n+1]).catch(e=>{
    if(e?.code==='42P01')return {rows:[]};
    throw e;
   });
   const rows=r.rows||[];
   return {ids:rows.slice(0,n).map(x=>SERIES.exec(x.media_key)?.[1])
    .filter(Boolean),limited:rows.length>n};
  },
  async save(input){
   const item=validateCuratedMetadata(input);
   if(!await persisted(item.key))
    return {ok:false,code:'curated_media_not_registered'};
   await ensure(); // schema creation occurs only after explicit owner save.
   const r=await pool.query([
    'INSERT INTO blofy_content_hub_curated_metadata',
    '(media_key,title,release_year,genre,overview,poster_path)',
    'VALUES($1,$2,$3,$4,$5,$6)',
    'ON CONFLICT(media_key) DO UPDATE SET',
    'title=EXCLUDED.title,release_year=EXCLUDED.release_year,',
    'genre=EXCLUDED.genre,overview=EXCLUDED.overview,',
    'poster_path=EXCLUDED.poster_path,updated_at=NOW()',
    'RETURNING media_key,title,release_year,genre,overview,poster_path,updated_at'
   ].join(' '),[item.key,item.title,item.year,item.genre,
     item.overview,item.posterPath]);
   return {ok:true,metadata:toItem(r.rows[0]),automaticDownload:false,
    customerCutover:false,providerMediaRequests:0,storageRequests:0};
  },
  async close(){await pool.end()}
 };
}
