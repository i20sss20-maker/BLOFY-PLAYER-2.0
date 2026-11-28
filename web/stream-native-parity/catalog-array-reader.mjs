// Stream just the requested page, but never accept an incomplete or invalid
// upstream document as an authoritative empty/partial catalog.
export async function readCatalogPage(reader,{offset,limit,match=()=>true,rank=null,maxBytes=100*1024*1024}){
 const decoder=new TextDecoder('utf-8',{fatal:true}),items=[];
 const ranked=typeof rank==='function',buckets=ranked?Array.from({length:6},()=>[]):null;
 const keep=offset+limit;
 if(ranked&&(!Number.isSafeInteger(keep)||keep<1||keep>1050))throw Error('catalog_rank_limit');
 function result(){
  if(!ranked)return {items,hasMore:false,nextOffset:offset+items.length};
  const ordered=[];for(let i=5;i>=1;i--)ordered.push(...buckets[i]);
  const page=ordered.slice(offset,keep);return {items:page,hasMore:matched>offset+page.length,nextOffset:offset+page.length};
 }
 let state='start',text='',depth=0,inString=false,escapeNext=false,matched=0,bytes=0;
 function consume(piece){
  for(let i=0;i<piece.length;i++){
   const ch=piece[i];
   if(state==='object'){
    text+=ch;
    if(text.length>200000)throw Error('catalog_item_too_large');
    if(escapeNext){escapeNext=false;continue}
    if(inString&&ch==='\\'){escapeNext=true;continue}
    if(ch==='"'){inString=!inString;continue}
    if(!inString){if(ch==='{')depth++;else if(ch==='}')depth--}
    if(depth!==0)continue;
    const item=JSON.parse(text);
    if(match(item)){
     if(ranked){const n=rank(item);if(Number.isInteger(n)&&n>=1&&n<=5){matched++;if(buckets[n].length<keep)buckets[n].push(item)}}
     else {
     if(matched>=offset){
      if(items.length>=limit)return true;
      items.push(item);
     }
     matched++;
     }
    }
    text='';state='delimiter';continue;
   }
   if(/\s/.test(ch))continue;
   if(state==='start'&&ch==='['){state='first';continue}
   if((state==='first'||state==='value')&&ch==='{'){
    state='object';text='{';depth=1;inString=false;escapeNext=false;continue
   }
   if(state==='delimiter'&&ch===','){state='value';continue}
   if((state==='first'||state==='delimiter')&&ch===']'){state='closed';continue}
   throw Error('catalog_invalid_array');
  }
  return false
 }
 for(;;){
  const part=await reader.read();
  if(part.done){
   if(consume(decoder.decode()))return {items,hasMore:true,nextOffset:offset+items.length};
   if(state!=='closed')throw Error('catalog_truncated');
   return result();
  }
  bytes+=part.value.byteLength;
  if(bytes>maxBytes)throw Error('catalog_byte_limit');
  if(consume(decoder.decode(part.value,{stream:true})))return {items,hasMore:true,nextOffset:offset+items.length};
 }
}
