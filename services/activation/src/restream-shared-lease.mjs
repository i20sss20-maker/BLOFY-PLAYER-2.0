// Experimental, in-memory lease coordinator for future authorized shared HLS sources.
// NOT wired to customer playback. Caller must enforce source licensing, viewer
// authentication and a stable rights-scoped source key. Supports one process only.
export function createSharedStreamCoordinator({start,stop,clock=Date.now,
 idleMs=15000,maxEntries=100,maxViewersPerKey=200}={}){
 if(typeof start!=='function'||typeof stop!=='function')
  throw new TypeError('stream_start_stop_required');
 const entries=new Map();
 function validKey(value){
  return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 }
 async function acquire(key,{authorized=false}={}){
  if(!authorized||!validKey(key))throw new Error('shared_stream_not_authorized');
  let entry=entries.get(key);
  if(!entry){
   if(entries.size>=maxEntries)throw new Error('shared_stream_capacity_reached');
   entry={key,viewers:0,lastUsedAt:clock(),timer:null,pending:null,handle:null,generation:0};
   entries.set(key,entry);
  }
  if(entry.stopping)throw new Error('shared_stream_recycling');
  if(entry.viewers>=maxViewersPerKey)throw new Error('shared_stream_viewer_limit');
  if(entry.timer){clearTimeout(entry.timer);entry.timer=null;}
  entry.viewers++;entry.lastUsedAt=clock();
  const current=entry;
  if(!entry.pending&&!entry.handle){
   const generation=++entry.generation;
   entry.pending=Promise.resolve().then(()=>start(key)).then(handle=>{
    if(handle==null)throw Error('shared_stream_start_empty');
    if(entry.generation===generation)entry.handle=handle;
    return handle;
   }).catch(error=>{
    if(entry.generation===generation)entry.handle=null;
    throw error;
   }).finally(()=>{if(entry.generation===generation)entry.pending=null;});
  }
  try{
   const handle=entry.handle ?? await entry.pending;
   let released=false;
   return {handle,release(){
    if(released)return false;
    released=true;
    if(entries.get(key)!==current)return false;
    current.viewers=Math.max(0,current.viewers-1);
    current.lastUsedAt=clock();
    if(current.viewers===0&&!current.timer){
     current.timer=setTimeout(async()=>{
      current.timer=null;
      if(current.viewers!==0||entries.get(key)!==current)return;
      // Keep the entry locked until stop finishes to prevent overlapping publishers.
      current.stopping=true;
      try{if(current.handle!=null)await stop(current.handle,key);}catch{}
      finally{if(entries.get(key)===current)entries.delete(key);current.stopping=false;}
     },Math.max(0,idleMs));
     current.timer.unref?.();
    }
    return true;
   }};
  }catch(error){
   entry.viewers=Math.max(0,entry.viewers-1);
   if(entry.viewers===0 && entries.get(key)===entry && !entry.handle && !entry.pending)
    entries.delete(key);
   throw error;
  }
 }
 function snapshot(){
  return {scope:'single_process_experimental',productionEnabled:false,
    keys:entries.size,activeViewers:[...entries.values()].reduce((n,x)=>n+x.viewers,0),
    activePublishers:[...entries.values()].filter(x=>x.handle!=null).length};
 }
 return {acquire,snapshot};
}
