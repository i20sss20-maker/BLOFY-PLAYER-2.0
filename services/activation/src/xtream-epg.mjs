// Real Xtream EPG: sanitize provider data and never invent a program guide.
// Data is fetched only for a channel which the requesting account may access.
const fields=['id','epg_id','title','description','start','end','start_timestamp',
  'stop_timestamp','channel_id','lang','has_archive','now_playing','tvg_id'];

export function normalizeXtreamEpg(payload,limit=20) {
  const max=Math.max(1,Math.min(50,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):20));
  const rows=Array.isArray(payload)?payload:
    Array.isArray(payload?.epg_listings)?payload.epg_listings:
    Array.isArray(payload?.listings)?payload.listings:[];
  return {epg_listings:rows.slice(0,max).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>{
    const clean={};
    for(const key of fields){
      if(!Object.hasOwn(row,key))continue;
      const value=row[key];
      if(typeof value==='string')clean[key]=value.slice(0,key==='description'?4000:1024);
      else if(typeof value==='number'&&Number.isFinite(value))clean[key]=value;
      else if(typeof value==='boolean')clean[key]=value?1:0;
    }
    return clean;
  })};
}
