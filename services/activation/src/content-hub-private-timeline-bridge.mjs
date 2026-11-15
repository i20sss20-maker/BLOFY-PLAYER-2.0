// Fixed private owner-site timeline relay: no arbitrary upstream URLs, S3
// object keys, provider credentials or customer playback routes.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const HUB='http://blofy-content-hub.railway.internal:3000';
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MAX=18*1024*1024;
const SEGMENT_SECONDS=30;
function fail(res,status,code){
 if(res.headersSent){if(!res.destroyed)res.destroy();return}
 const body=Buffer.from(JSON.stringify({ok:false,code}));
 res.writeHead(status,{'content-type':'application/json','content-length':String(body.length),
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(body);
}
export async function forwardPrivateTimeline({
 req,res,hubToken,mediaKind,runId,segment=null,fetchImpl=fetch
}={}){
 if(!['movie','episode'].includes(mediaKind)||!RUN.test(String(runId||''))||
    segment!==null&&(typeof segment!=='string'||
     !/^(0|[1-9][0-9]{0,3})$/.test(segment)))
  return fail(res,400,'private_timeline_selection_invalid');
 if(req.method!=='GET'||String(req.url||'').includes('?'))
  return fail(res,405,'private_timeline_method_denied');
 if(typeof hubToken!=='string'||hubToken.length<32)
  return fail(res,503,'private_timeline_bridge_not_configured');
 const abort=new AbortController();
 const timer=setTimeout(()=>abort.abort(),148000);timer.unref?.();
 const disconnect=()=>abort.abort();
 res.once('close',disconnect);
 try{
  const upstream=await fetchImpl(
   HUB+'/internal/site-qa/timeline/'+mediaKind+'/'+runId+'/' +
    (segment===null?'meta':'clip/'+segment+'.mp4'),{
     method:'GET',redirect:'manual',signal:abort.signal,
     headers:{authorization:'Bearer '+hubToken,
      'x-blofy-owner-action':'private-verified-s3-timeline',
      accept:segment===null?'application/json':'video/mp4'}
    });
  if(upstream.status===404)return fail(res,404,'private_timeline_not_available');
  if(upstream.status===429)return fail(res,429,'private_timeline_busy');
  if(upstream.status!==200)return fail(res,503,'private_timeline_upstream_unavailable');
  if(segment===null){
   if(!String(upstream.headers.get('content-type')||'').startsWith('application/json'))
    return fail(res,503,'private_timeline_metadata_type_invalid');
   const len=Number(upstream.headers.get('content-length')||'0');
   if(!Number.isSafeInteger(len)||len>4096)return fail(res,503,
    'private_timeline_metadata_too_large');
   const raw=await upstream.text();
   if(Buffer.byteLength(raw)>4096)return fail(res,503,'private_timeline_metadata_too_large');
   let data;try{data=JSON.parse(raw)}catch{}
   const duration=Number(data?.durationSeconds),seconds=Number(data?.segmentSeconds);
   const count=Number(data?.segmentCount);
   if(data?.ok!==true||data?.mediaKind!==mediaKind||data?.runId!==runId||
     data?.customerCutover!==false||data?.fullFilePlaybackVerified!==false||
     !Number.isFinite(duration)||duration<25||duration>36000||
     seconds!==SEGMENT_SECONDS||!Number.isSafeInteger(count)||
     count!==Math.ceil(duration/seconds)||count<1||count>1200)
    return fail(res,503,'private_timeline_metadata_invalid');
   const body=Buffer.from(JSON.stringify({
    ok:true,mediaKind,runId,durationSeconds:duration,
    segmentSeconds:seconds,segmentCount:count,
    privateOnly:true,providerRequests:0,customerCutover:false,
    fullFilePlaybackVerified:false,customerReleaseApproved:false}));
   res.writeHead(200,{'content-type':'application/json',
    'content-length':String(body.length),'cache-control':'no-store',
    'x-content-type-options':'nosniff'});
   return res.end(body);
  }
  if(!upstream.body||upstream.headers.get('content-type')!=='video/mp4')
   return fail(res,503,'private_timeline_video_invalid');
  const length=Number(upstream.headers.get('content-length'));
  const index=Number(upstream.headers.get('x-blofy-timeline-index'));
  const offset=Number(upstream.headers.get('x-blofy-timeline-offset'));
  const duration=Number(upstream.headers.get('x-blofy-timeline-duration'));
  if(!Number.isSafeInteger(length)||length<2048||length>MAX||
     !Number.isSafeInteger(index)||index!==Number(segment)||
     offset!==index*SEGMENT_SECONDS||
     !Number.isFinite(duration)||duration<=0||duration>SEGMENT_SECONDS||
     upstream.headers.get('x-blofy-timeline-source')!=='verified-private-s3')
   return fail(res,503,'private_timeline_video_proof_invalid');
  let seen=0;
  const bounded=new Transform({transform(bytes,enc,done){
   seen+=bytes.byteLength;
   done(seen<=length?null:Error('private_timeline_overrun'),bytes);
  }});
  res.writeHead(200,{'content-type':'video/mp4',
   'content-length':String(length),
   'content-disposition':'inline; filename="blofy-private-timeline.mp4"',
   'cache-control':'private,no-store',
   'cross-origin-resource-policy':'same-origin',
   'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
   'x-blofy-timeline-index':String(index),
   'x-blofy-timeline-offset':String(offset),
   'x-blofy-timeline-duration':String(duration),
   'x-blofy-timeline-source':'verified-private-s3'});
  await pipeline(Readable.fromWeb(upstream.body),bounded,res,{signal:abort.signal});
  if(seen!==length&&!res.destroyed)res.destroy();
 }catch{
  if(!abort.signal.aborted)fail(res,503,'private_timeline_bridge_failed');
 }finally{
  clearTimeout(timer);res.off('close',disconnect);
 }
}
