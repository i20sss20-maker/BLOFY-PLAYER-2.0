import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const generation=/^[a-f0-9]{32}$/;
const segment=/^seg-[0-9]{9,16}\.ts$/;
const hosts=new Set(['media.blofyplayer.com','media2.blofyplayer.com']);
const pathPattern=/^\/v1\/([a-f0-9]{32})\/[a-f0-9]{32}\/(\d{10})\/[a-f0-9]{64}\/index\.m3u8$/;
// Single-rendition engine HLS. Manifest URIs remain relative to the
// authenticated BLOFY route, not the short-lived worker HMAC URL.
// Reject arbitrary URIs, encryption keys and unsupported playlist types.
export function validateEngineManifest(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>65536)return null;
 const lines=input.split(/\r?\n/);
 if(lines[0]!=='#EXTM3U')return null;
 let pending=false,count=0,previous=-1;
 for(const line of lines.slice(1)){
  if(!line)continue;
  if(/^#EXTINF:\d+(?:\.\d+)?,(?:[^\r\n]{0,80})$/.test(line)){
   if(pending)return null;pending=true;continue;
  }
  if(line.startsWith('#')){
   if(pending||!/^#EXT-X-(?:VERSION:\d+|TARGETDURATION:\d+|MEDIA-SEQUENCE:\d+|DISCONTINUITY-SEQUENCE:\d+|DISCONTINUITY|INDEPENDENT-SEGMENTS|ENDLIST)$/.test(line))return null;
   continue;
  }
  if(!pending||!segment.test(line))return null;
  const n=Number(line.slice(4,-3));if(!Number.isSafeInteger(n)||(previous!==-1&&n!==previous+1))return null;
  previous=n;pending=false;count++;
 }
 return !pending&&count>=3&&count<=64?lines.join('\n'):null;
}
async function boundedText(body){
 const reader=body.getReader();const chunks=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>65536)throw Error('manifest_too_large');chunks.push(Buffer.from(r.value));}
 return Buffer.concat(chunks).toString('utf8');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
// Called only by a stable authenticated playback endpoint. authorizeGrant
// MUST recheck subscriber/catalog ACL, committed viewer session, generation,
// fresh worker proof and rights on EACH manifest/segment request. It returns
// a new server-generated signedLinodePlayback grant, never caller URLs.
// Worker capabilities never leave the backend; no redirect to an expired URL.
export function createEngineHlsDelivery({authorizeGrant,fetchImpl=fetch,enabled=false,clock=Date.now}={}){
 return async function deliver(req,res,context){
  const fail=(code)=>{if(!res.headersSent&&!res.destroyed){res.writeHead(code,{'cache-control':'no-store','retry-after':'2','content-type':'text/plain'});res.end('Playback temporarily unavailable')}else if(!res.destroyed)res.destroy()};
  if(!enabled||typeof authorizeGrant!=='function')return fail(503);
  if(req.method!=='GET'||!generation.test(context?.generation??'')||
    (context?.name!=='index.m3u8'&&!segment.test(context?.name??'')))return fail(404);
  const c=new AbortController(),abort=()=>c.abort();
  req.once('aborted',abort);res.once('close',abort);
  let upstream;
  try{
   if(req.aborted||res.destroyed)return;
   const grant=await authorizeGrant(context);
   if(!grant?.ok||!hosts.has(grant.mediaHost)||typeof grant.path!=='string')return fail(403);
   const m=pathPattern.exec(grant.path),now=clock();
   if(!m||m[1]!==context.generation||Number(m[2])*1000<=now+3000||Number(m[2])*1000>now+65000)return fail(503);
   const url='https://'+grant.mediaHost+grant.path.slice(0,-'index.m3u8'.length)+context.name;
   upstream=await fetchImpl(url,{method:'GET',redirect:'error',headers:{accept:context.name==='index.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t','accept-encoding':'identity'},signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});
   if(upstream.status!==200||!upstream.body)return fail(502);
   if(context.name==='index.m3u8'){
    const manifest=validateEngineManifest(await boundedText(upstream.body));
    if(!manifest)return fail(502);
    const body=Buffer.from(manifest);
    res.writeHead(200,{'content-type':'application/vnd.apple.mpegurl','content-length':body.length,'cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    return res.end(body);
   }
   const type=upstream.headers.get('content-type')||'';
   if(!/^(video\/mp2t|application\/octet-stream)(?:;|$)/i.test(type))return fail(502);
   const len=upstream.headers.get('content-length');
   if(!len||!/^\d{1,8}$/.test(len)||Number(len)<188||Number(len)>32*1024*1024)return fail(502);
   // Bound segment size even if a broken origin sends a mismatched body.
   const expected=Number(len);let sent=0;
   async function* media(){for await(const chunk of upstream.body){sent+=chunk.byteLength;if(sent>expected)throw Error('segment_length');yield Buffer.from(chunk)}if(sent!==expected)throw Error('segment_length')}
   res.writeHead(200,{'content-type':'video/mp2t','content-length':len,'cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   await pipeline(Readable.from(media()),res,{signal:c.signal});
  }catch{if(!res.destroyed)fail(502)}
  finally{req.off('aborted',abort);res.off('close',abort);c.abort();if(upstream?.body&&!upstream.bodyUsed)await upstream.body.cancel().catch(()=>{})}
 };
}
