import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {validateEngineManifest} from './blofy-engine-hls-delivery.mjs';
// Compatibility adapter for clients that require a continuous MPEG-TS body.
// Reads already generated HLS only, never opens an upstream provider feed.
// fetchPart must be a server-owned, freshly authorized worker grant reader.
// A generation change ends this response; the old client can reconnect to
// its unchanged original URL. Never splice unrelated generations together.
export function createEngineTsCompatibility({fetchPart,enabled=false,clock=Date.now,pause=sleep}={}){
 return async function deliver(req,res,context){
  if(!enabled||typeof fetchPart!=='function')return false;
  if(req.method!=='GET'||!/^[a-f0-9]{32}$/.test(context?.generation??''))return false;
  const ctl=new AbortController(),abort=()=>ctl.abort();
  req.once('aborted',abort);res.once('close',abort);
  let last=null,lastProgress=clock(),started=false;
  const part=async name=>{
   const r=await fetchPart({...context,name},{signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(10000)])});
   if(r?.status!==200||!r.body||r.generation!==context.generation){
    await r?.body?.cancel().catch(()=>{});throw Error('engine_part_unavailable');
   }
   return r;
  };
  async function readManifest(){
   const r=await part('index.m3u8'),reader=r.body.getReader(),chunks=[];let n=0;
   try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;if(n>65536)throw Error('manifest_limit');chunks.push(Buffer.from(x.value))}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   const m=validateEngineManifest(Buffer.concat(chunks).toString('utf8'));
   if(!m||m.includes('#EXT-X-ENDLIST')||m.includes('#EXT-X-DISCONTINUITY'))throw Error('invalid_live_manifest');
   return m.split('\n').filter(x=>/^seg-[0-9]{9}\.ts$/.test(x));
  }
  async function* media(initial){
   let names=initial;
   while(!ctl.signal.aborted){
    if(last===null)names=names.slice(-3);
    for(const name of names){
     const seq=Number(name.slice(4,-3));
     if(last!==null&&seq<=last)continue;
     if(last!==null&&seq!==last+1)throw Error('segment_gap');
     const r=await part(name);
     const length=Number(r.headers.get('content-length'));
     if(!/^video\/mp2t(?:;|$)/i.test(r.headers.get('content-type')||'')||
        !Number.isSafeInteger(length)||length<188||length>64*1024*1024||length%188!==0){
      await r.body.cancel().catch(()=>{});throw Error('invalid_ts_segment');
     }
     let bytes=0,tail=Buffer.alloc(0);
     try{for await(const chunk of r.body){
      bytes+=chunk.byteLength;if(bytes>length)throw Error('segment_length');
      const b=Buffer.concat([tail,Buffer.from(chunk)]),end=b.length-b.length%188;
      for(let i=0;i<end;i+=188)if(b[i]!==0x47)throw Error('invalid_ts_sync');
      if(end)yield b.subarray(0,end);
      tail=b.subarray(end);
     }}finally{if(!r.bodyUsed)await r.body.cancel().catch(()=>{})}
     if(bytes!==length)throw Error('segment_length');
     last=seq;lastProgress=clock();
    }
    if(clock()-lastProgress>12000)throw Error('engine_stalled');
    await pause(500,undefined,{signal:ctl.signal});
    names=await readManifest();
   }
  }
  try{
   if(req.aborted||res.destroyed)return true;
   const initial=await readManifest();
   if(ctl.signal.aborted)return true;
   res.writeHead(200,{'content-type':'video/mp2t','cache-control':'no-store, no-transform','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
   started=true;
   await pipeline(Readable.from(media(initial)),res,{signal:ctl.signal});
  }catch{
   if(!res.destroyed&&!req.aborted){
    if(!started){res.writeHead(503,{'retry-after':'2','cache-control':'no-store'});res.end('Playback temporarily unavailable')}
    else res.destroy();
   }
  }finally{abort();req.off('aborted',abort);res.off('close',abort)}
  return true;
 };
}
