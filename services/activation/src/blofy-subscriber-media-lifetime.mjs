import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
// A subscriber who changes channel or closes playback must cancel the old
// upstream request. Do not leave a detached provider socket consuming quota.
export async function withSubscriberMediaLifetime(req,res,fn){
 const controller=new AbortController();
 const abort=()=>controller.abort();
 req.once('aborted',abort);res.once('close',abort);
 try{
  if(req.aborted||res.destroyed||res.writableEnded){abort();return}
  return await fn(controller.signal);
 }finally{
  controller.abort();
  req.off('aborted',abort);res.off('close',abort);
 }
}
export async function pipeSubscriberMedia(body,res,{transform,signal}={}){
 const readable=Readable.fromWeb(body);
 if(transform)return pipeline(readable,transform,res,{signal});
 return pipeline(readable,res,{signal});
}
export async function readBoundedSubscriberManifest(body,max=2*1024*1024){
 const reader=body.getReader();const chunks=[];let n=0;
 try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;if(n>max)throw Error('subscriber_manifest_too_large');chunks.push(Buffer.from(x.value))}
 return Buffer.concat(chunks).toString('utf8');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
