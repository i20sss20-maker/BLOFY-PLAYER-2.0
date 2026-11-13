// Strict parser for authenticated admin-only video canary Range requests.
export const HUB_MAX_CANARY_RANGE=8*1024*1024;
export const HUB_PILOT_RUN=/^[A-Za-z0-9_-]{8,80}$/;
export function adminCanaryRange(header,total){
 if(!Number.isSafeInteger(total)||total<=0||total>4*1024**3)return null;
 const raw=String(header||'').trim();
 if(!raw)return {from:0,to:Math.min(total,HUB_MAX_CANARY_RANGE)-1};
 const open=/^bytes=(0|[1-9][0-9]*)-([0-9]*)$/.exec(raw);
 if(open){
  const from=Number(open[1]),explicit=open[2]!==''?Number(open[2]):null;
  if(!Number.isSafeInteger(from)||from>=total||
    explicit!==null&&(!Number.isSafeInteger(explicit)||explicit<from))return null;
  const to=Math.min(total-1,from+HUB_MAX_CANARY_RANGE-1,
    explicit===null?total-1:explicit);
  return {from,to};
 }
 const suffix=/^bytes=-([1-9][0-9]*)$/.exec(raw);
 if(suffix){
  const count=Number(suffix[1]);
  if(!Number.isSafeInteger(count)||count<=0)return null;
  const from=Math.max(0,total-Math.min(count,HUB_MAX_CANARY_RANGE));
  return {from,to:total-1};
 }
 return null;
}
