// Authenticated STREAM->Portal->Hub original-media relay for SITE QA only.
// Owner gets bounded byte ranges of exact verified S3 file, not source URLs.
// No client app or subscriber routes are involved; Hub defaults disabled.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const HUB='http://blofy-content-hub.railway.internal:3000';
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MAX=8*1024*1024,MAX_FILE=4*1024**3;
const TYPES=new Set(['video/x-matroska','video/mp4','video/mp2t','video/x-msvideo']);
function fail(res,status,code){
 if(res.headersSent){if(!res.destroyed)res.destroy();return}
 const body=Buffer.from(JSON.stringify({ok:false,code}));
 res.writeHead(status,{'content-type':'application/json','content-length':String(body.length),
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(body);
}
export async function forwardPrivateOriginalRange({
 req,res,hubToken,mediaKind,runId,fetchImpl=fetch
}={}){
 if(!['movie','episode'].includes(mediaKind)||!RUN.test(String(runId||'')))
  return fail(res,400,'site_qa_selection_invalid');
 if(!['GET','HEAD'].includes(req.method)||
    String(req.url||'').includes('?'))
  return fail(res,405,'site_qa_method_or_query_denied');
 if(typeof hubToken!=='string'||hubToken.length<32)
  return fail(res,503,'site_qa_bridge_not_configured');
 const range=String(req.headers.range||'');
 if(range.length>90||range.includes(',')||
    (range&&!/^bytes=(?:0|[1-9][0-9]*)-(?:(?:0|[1-9][0-9]*))?$/.test(range)
     &&!/^bytes=-[1-9][0-9]*$/.test(range)))
  return fail(res,416,'site_qa_range_invalid');
 const abort=new AbortController();
 const timer=setTimeout(()=>abort.abort(),45000);timer.unref?.();
 const onClose=()=>abort.abort();
 res.once('close',onClose);
 try{
  const upstream=await fetchImpl(
    HUB+'/internal/site-qa/files/'+mediaKind+'/'+runId,{
      method:req.method,redirect:'manual',signal:abort.signal,
      headers:{
       authorization:'Bearer '+hubToken,
       'x-blofy-owner-action':'private-original-range-qa',
       ...(range?{range}:{})
      }
    });
  if(upstream.status===404)return fail(res,404,'site_qa_original_unavailable');
  if((req.method==='HEAD'&&upstream.status!==200)||
     (req.method==='GET'&&upstream.status!==206))
   return fail(res,503,'site_qa_original_not_ready');
  const type=upstream.headers.get('content-type');
  if(!TYPES.has(type))return fail(res,503,'site_qa_type_invalid');
  const length=Number(upstream.headers.get('content-length'));
  if(!Number.isSafeInteger(length)||length<1||
     length>(req.method==='HEAD'?MAX_FILE:MAX))
   return fail(res,503,'site_qa_length_invalid');
  const safeHeaders={
   'content-type':type,'content-length':String(length),'accept-ranges':'bytes',
   'cache-control':'private,no-store','cross-origin-resource-policy':'same-origin',
   'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
   'x-frame-options':'DENY'
  };
  if(req.method==='HEAD'){res.writeHead(200,safeHeaders);return res.end()}
  const cr=String(upstream.headers.get('content-range')||'');
  const m=/^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/.exec(cr);
  if(!m||!Number.isSafeInteger(Number(m[3]))||Number(m[3])>MAX_FILE||
     Number(m[2])<Number(m[1])||Number(m[2])>=Number(m[3])||
     Number(m[2])-Number(m[1])+1!==length||!upstream.body)
   return fail(res,503,'site_qa_content_range_invalid');
  // Require the returned range to match the client request, after the
  // Hub's intentional 8MiB cap for open ranges; never accept another part.
  const from=Number(m[1]),to=Number(m[2]),total=Number(m[3]);
  if(range){
   let expectedFrom=null,expectedTo=null;
   const forward=/^bytes=(\d+)-(\d*)$/.exec(range);
   const suffix=/^bytes=-(\d+)$/.exec(range);
   if(forward){
    expectedFrom=Number(forward[1]);
    expectedTo=forward[2]===''?Math.min(total-1,expectedFrom+MAX-1):
      Number(forward[2]);
   }else if(suffix){
    expectedTo=total-1;
    expectedFrom=Math.max(0,total-Number(suffix[1]));
   }
   if(from!==expectedFrom||to!==expectedTo)
    return fail(res,503,'site_qa_unexpected_range');
  }else if(from!==0||to!==Math.min(total,MAX)-1)
   return fail(res,503,'site_qa_unexpected_default_range');
  let seen=0;
  const bounded=new Transform({transform(bytes,enc,done){
    seen+=bytes.byteLength;
    done(seen<=length?null:Error('site_qa_overrun'),bytes);
  }});
  res.writeHead(206,{...safeHeaders,'content-range':cr});
  await pipeline(Readable.fromWeb(upstream.body),bounded,res,{signal:abort.signal});
  if(seen!==length&&!res.destroyed)res.destroy();
 }catch{
  if(!abort.signal.aborted)fail(res,503,'site_qa_private_relay_failed');
 }finally{
  clearTimeout(timer);
  res.off('close',onClose);
 }
}
