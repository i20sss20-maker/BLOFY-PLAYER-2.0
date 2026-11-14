// Private operator-only preview relay. Bounded streaming instead of JSON
// buffering; no source URLs, provider credentials, bucket names or customer
// playback changes. Caller has already authenticated the STREAM bridge.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const HUB='http://blofy-content-hub.railway.internal:3000';
const MAX_PREVIEW=12*1024*1024;
function fail(res,status,code){
 if(res.headersSent){if(!res.destroyed)res.destroy();return}
 const body=Buffer.from(JSON.stringify({ok:false,code}));
 res.writeHead(status,{'content-type':'application/json',
  'cache-control':'no-store','content-length':String(body.length),
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(body);
}
export async function forwardPrivatePreview({
 req,res,hubToken,fetchImpl=fetch,mediaKind='movie'
}={}){
 if(!['movie','episode'].includes(mediaKind))
  return fail(res,400,'owner_preview_media_kind_invalid');
 if(req.method!=='GET')return fail(res,405,'owner_preview_method_denied');
 if(String(req.url||'').includes('?'))
  return fail(res,400,'owner_preview_query_denied');
 if(typeof hubToken!=='string'||hubToken.length<32)
  return fail(res,503,'owner_preview_bridge_not_configured');
 const abort=new AbortController();
 const timer=setTimeout(()=>abort.abort(),85000);timer.unref?.();
 const closed=()=>abort.abort();
 res.once('close',closed);
 let count=0;
 try{
  const episode=mediaKind==='episode';
  const upstream=await fetchImpl(HUB+
    (episode?'/internal/episodes/playback/preview':
      '/internal/playback/preview'),{
    method:'GET',redirect:'manual',signal:abort.signal,
    headers:{authorization:'Bearer '+hubToken,
      'x-blofy-owner-preview':episode?'operator-episode-only':'operator-only'}
  });
  if(upstream.status!==200||!upstream.body||
     upstream.headers.get('content-type')!=='video/mp4')
   return fail(res,upstream.status===409?409:503,
      'owner_preview_not_ready');
  const expected=Number(upstream.headers.get('content-length'));
  if(!Number.isSafeInteger(expected)||expected<2048||expected>MAX_PREVIEW)
   return fail(res,503,'owner_preview_upstream_size_invalid');
  const bounded=new Transform({transform(chunk,enc,cb){
   count+=chunk.byteLength;
   cb(count<=expected?null:Error('owner_preview_overrun'),chunk);
  }});
  res.writeHead(200,{
   'content-type':'video/mp4',
   'content-length':String(expected),
   'content-disposition':'inline; filename="blofy-private-preview.mp4"',
   'cache-control':'private,no-store',
   'cross-origin-resource-policy':'same-origin',
   'x-content-type-options':'nosniff',
   'referrer-policy':'no-referrer'
  });
  await pipeline(Readable.fromWeb(upstream.body),bounded,res,{
    signal:abort.signal});
  if(count!==expected&&!res.destroyed)res.destroy();
 }catch{
  if(!abort.signal.aborted)fail(res,503,'owner_preview_private_stream_failed');
 }finally{
  clearTimeout(timer);
  res.off('close',closed);
 }
}
