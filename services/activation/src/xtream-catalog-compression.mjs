// Honor HTTP Accept-Encoding without changing older Xtream clients.
// Never serve compressed content to clients that did not opt in.
export function acceptsXtreamGzip(value){
  if(typeof value!=='string'||!value.trim())return false;
  for(const token of value.split(',')){
    const parts=token.split(';').map(v=>v.trim());
    if(parts[0].toLowerCase()!=='gzip')continue;
    const q=parts.slice(1).find(part=>/^q\s*=/i.test(part));
    if(!q)return true;
    const quality=Number(q.split('=')[1]);
    return Number.isFinite(quality)&&quality>0&&quality<=1;
  }
  return false;
}
