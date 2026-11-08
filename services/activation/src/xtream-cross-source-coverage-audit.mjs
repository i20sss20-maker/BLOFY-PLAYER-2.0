// Read-only overlap between two operator-owned Xtream catalogs.
// Never return IDs, titles, provider URLs, auth material or make playback
// decisions. A title match alone is NOT a safe cross-source substitute.
const key=value=>String(value??'').trim().toLowerCase();
const imdb=value=>/^tt\d{5,10}$/.test(key(value))?key(value):'';
const tmdb=value=>/^\d{1,10}$/.test(String(value??'').trim())
  ?String(value).trim():'';
const year=value=>/^\d{4}$/.test(String(value??'').trim())
  ?String(value).trim():'';

export function summarizeSameMovieCandidates(primary,alternateRows){
 const p=primary&&typeof primary==='object'?primary:{};
 const m=p.metadata&&typeof p.metadata==='object'?p.metadata:{};
 const title=key(p.name);
 const ids={tmdb:tmdb(m.tmdb),imdb:imdb(m.imdb),year:year(m.year)};
 let sameTitle=0,strongMatch=0,yearConflict=0,alternativeCandidates=0;
 for(const row of Array.isArray(alternateRows)?alternateRows.slice(0,20):[]){
  const other=row&&typeof row==='object'?row:{};
  const om=other.metadata&&typeof other.metadata==='object'?other.metadata:{};
  const otmdb=tmdb(om.tmdb),oimdb=imdb(om.imdb),oyear=year(om.year);
  const sameTmdb=!!ids.tmdb&&otmdb===ids.tmdb;
  const sameImdb=!!ids.imdb&&oimdb===ids.imdb;
  const titleEqual=!!title&&key(other.name)===title;
  const differentYear=!!ids.year&&!!oyear&&ids.year!==oyear;
  alternativeCandidates++;
  if(titleEqual)sameTitle++;
  if(differentYear)yearConflict++;
  if((sameTmdb||sameImdb)&&!differentYear)strongMatch++;
 }
 return {
  candidateCount:alternativeCandidates,sameTitleCount:sameTitle,
  matchingExternalIdCount:strongMatch,yearConflictCount:yearConflict,
  actualMediaVerified:false,automaticFailoverEnabled:false
 };
}
