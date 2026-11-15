// STREAM owner-only verified S3 seek clip relay. No provider/media URL,
// S3 credentials, or anonymous subscriber playback. Fixed private Hub route.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const HUB='http://blofy-content-hub.railway.internal:3000';
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MAX=12*1024*1024;
const POSITIONS=new Set(['start','middle','near_end']);
function fail(res,status,code){
 if(res.headersSent){if(!res.destroyed)res.destroy();return}
 const body=Buffer.from(JSON.stringify({ok:false,code}));
 res.writeHead(status,{'content-type':'application/json',
  'content-length':String(body.length),
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(body);
}
export async function forwardPrivateSeekPreview({
 req,res,hubToken,mediaKind,runId,position,fetchImpl=fetch
}={}){
 if(!['movie','episode'].includes(mediaKind)||
    !RUN.test(String(runId||''))||!POSITIONS.has(position))
  return fail(res,400,'site_qa_seek_selection_invalid');
 if(req.method!=='GET'||String(req.url||'').includes('?'))
  return fail(res,405,'site_qa_seek_method_denied');
 if(typeof hubToken!=='string'||hubToken.length<32)
  return fail(res,503,'site_qa_seek_bridge_not_configured');
 const abort=new AbortController();
 const timer=setTimeout(()=>abort.abort(),95000);timer.unref?.();
 const disconnect=()=>abort.abort();
 res.once('close',disconnect);
 try{
  const response=await fetchImpl(
    HUB+'/internal/site-qa/seek-preview/'+
      mediaKind+'/'+runId+'/'+position,{
      method:'GET',redirect:'manual',signal:abort.signal,
      headers:{authorization:'Bearer '+hubToken,
       'x-blofy-owner-action':'private-verified-s3-seek-clip',
       accept:'video/mp4'}
    });
  if(response.status===404)return fail(res,404,'site_qa_seek_not_available');
  if(response.status===429)return fail(res,429,'site_qa_seek_busy');
  if(response.status!==200||!response.body||
     response.headers.get('content-type')!=='video/mp4')
   return fail(res,503,'site_qa_seek_private_clip_unavailable');
  const expected=Number(response.headers.get('content-length'));
  if(!Number.isSafeInteger(expected)||expected<2048||expected>MAX)
   return fail(res,503,'site_qa_seek_payload_invalid');
  const pos=response.headers.get('x-blofy-clip-position');
  const start=Number(response.headers.get('x-blofy-clip-start-seconds'));
  if(pos!==position||!Number.isFinite(start)||start<0||
     response.headers.get('x-blofy-clip-source')!=='verified-private-s3')
   return fail(res,503,'site_qa_seek_proof_header_invalid');
  let count=0;
  const bounded=new Transform({transform(bytes,enc,done){
    count+=bytes.byteLength;
    done(count<=expected?null:Error('site_qa_seek_overflow'),bytes);
  }});
  res.writeHead(200,{'content-type':'video/mp4',
    'content-length':String(expected),
    'content-disposition':'inline; filename="blofy-owner-seek.mp4"',
    'cache-control':'private,no-store',
    'cross-origin-resource-policy':'same-origin',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'x-blofy-clip-position':position,
    'x-blofy-clip-start-seconds':String(Math.floor(start)),
    'x-blofy-clip-source':'verified-private-s3'});
  await pipeline(Readable.fromWeb(response.body),bounded,res,{signal:abort.signal});
  if(count!==expected&&!res.destroyed)res.destroy();
 }catch{
  if(!abort.signal.aborted)fail(res,503,'site_qa_seek_bridge_failed');
 }finally{
  clearTimeout(timer);
  res.off('close',disconnect);
 }
}
