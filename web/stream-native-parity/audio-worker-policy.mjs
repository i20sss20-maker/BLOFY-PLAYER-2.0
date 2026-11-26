// Audio-only admission is deliberately independent of the video encoder pool.
// The default isolated pilot has ONE slot; do not scale without licensed-source tests.
export function createAudioSlots(limit=1){
 const active=new Set();let denied=0;
 return {
  acquire(key){
   if(active.has(key)||active.size>=limit){denied++;return null}
   active.add(key);let released=false;
   return ()=>{if(!released){released=true;active.delete(key)}};
  },
  snapshot(){return {active:active.size,limit,denied}}
 };
}
export function audioContainer(raw){
 const mime=String(raw||'').split(';')[0].trim().toLowerCase();
 return ['video/mp2t','audio/ogg','audio/flac','audio/mpeg','audio/aac','audio/aacp','audio/mp4'].includes(mime)?mime:null
}
export function audioWorkerHost(mode){
 if(mode==='isolated')return 'http://blofy-stream-web-audio.railway.internal:8080';
 if(mode===''||mode==='shared')return 'http://blofy-stream-web-media.railway.internal:8080';
 return null
}
