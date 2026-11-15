// Private website QA byte-range parser. Up to 8 MiB per request, never a
// whole-file unbounded download. Only used after exact run/owner gates.
export const SITE_QA_MAX_RANGE=8*1024*1024;
export function parseSiteQaRange(header,total){
 if(!Number.isSafeInteger(total)||total<1||total>4*1024**3)return null;
 const raw=String(header||'').trim();
 if(raw.length>90)return null;
 if(!raw)return {from:0,to:Math.min(total,SITE_QA_MAX_RANGE)-1};
 const forward=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)?$/.exec(raw);
 if(forward){
  const from=Number(forward[1]),end=forward[2]===undefined?null:Number(forward[2]);
  if(!Number.isSafeInteger(from)||from>=total||
     end!==null&&(!Number.isSafeInteger(end)||end<from||end>=total||
       end-from+1>SITE_QA_MAX_RANGE))return null;
  return {from,to:end===null?Math.min(total-1,from+SITE_QA_MAX_RANGE-1):end};
 }
 const suffix=/^bytes=-([1-9][0-9]*)$/.exec(raw);
 if(suffix){
  const len=Number(suffix[1]);
  if(!Number.isSafeInteger(len)||len<1||len>SITE_QA_MAX_RANGE)return null;
  return {from:Math.max(0,total-len),to:total-1};
 }
 return null;
}
