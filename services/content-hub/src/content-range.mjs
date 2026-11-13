// Strict Content-Range metadata, never accepts unknown total or changed
// first-byte offset. A private source bridge must return 206 before use.
export function parseStrictContentRange(header,from,to){
 const m=/^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/([1-9][0-9]*)$/.exec(
  String(header||'').trim());
 if(!m)return null;
 const [start,end,total]=m.slice(1).map(Number);
 if(![start,end,total].every(Number.isSafeInteger)||
  start!==from||end!==to||total<=to||total>64*1024*1024*1024)
  return null;
 return {totalSize:total};
}
