// Owner-only, opt-in DEVICE QA capability for one SHA-verified Content Hub
// episode. Does not grant subscriber playback or expose operator credentials.
// The caller authenticates to the existing admin hook BEFORE minting.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';

export const DEVICE_QA_TTL_SECONDS=15*60;
export const DEVICE_QA_MAX_RANGE=8*1024*1024;
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MIME=new Set(['video/mp4','video/x-matroska','video/mp2t','video/x-msvideo']);
const body=(res,status,code)=>{
 const bytes=Buffer.from(JSON.stringify({ok:false,code}));
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'content-length':String(bytes.length),'cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(bytes);
};
export const enabledOwnerDeviceQa=env=>
 env?.BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED==='1'&&
 typeof env?.BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY==='string'&&
 env.BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY.length>=32;
export const isDeviceQaRun=x=>typeof x==='string'&&RUN.test(x);

export function mintOwnerDeviceQaTicket({secret,runId,now=Date.now()}={}){
 if(typeof secret!=='string'||secret.length<32||!isDeviceQaRun(runId)||
    !Number.isSafeInteger(now)||now<0)throw Error('owner_device_qa_issue_invalid');
 const issued=Math.floor(now/1000);
 const payload=Buffer.from(JSON.stringify({
  v:1,aud:'blofy-private-device-qa',kind:'episode',runId,
  iat:issued,exp:issued+DEVICE_QA_TTL_SECONDS,
  nonce:randomBytes(16).toString('hex')
 })).toString('base64url');
 const signed='v1.'+payload;
 const signature=createHmac('sha256',secret).update(signed).digest('base64url');
 return {ticket:signed+'.'+signature,
  expiresAt:new Date((issued+DEVICE_QA_TTL_SECONDS)*1000).toISOString(),
  runId,mediaKind:'episode',privateOnly:true,customerCutover:false};
}

export function verifyOwnerDeviceQaTicket({secret,ticket,runId,now=Date.now()}={}){
 if(typeof secret!=='string'||secret.length<32||
    !isDeviceQaRun(runId)||typeof ticket!=='string'||
    ticket.length>600||!Number.isSafeInteger(now)||now<0)return false;
 const parts=/^(v1\.[A-Za-z0-9_-]{20,450})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
 if(!parts)return false;
 const sig=createHmac('sha256',secret).update(parts[1]).digest();
 const supplied=Buffer.from(parts[2],'base64url');
 if(supplied.length!==sig.length||!timingSafeEqual(sig,supplied))return false;
 try{
  const payload=JSON.parse(Buffer.from(parts[1].slice(3),'base64url').toString('utf8'));
  const current=Math.floor(now/1000);
  return payload.v===1&&payload.aud==='blofy-private-device-qa'&&
   payload.kind==='episode'&&payload.runId===runId&&
   typeof payload.nonce==='string'&&/^[a-f0-9]{32}$/.test(payload.nonce)&&
   Number.isSafeInteger(payload.iat)&&Number.isSafeInteger(payload.exp)&&
   payload.exp-payload.iat===DEVICE_QA_TTL_SECONDS&&
   payload.iat<=current+15&&current<payload.exp&&current>=payload.iat-15;
 }catch{return false}
}

export function strictDeviceQaRange(range,total){
 if(!Number.isSafeInteger(total)||total<1||total>4*1024**3)return null;
 const m=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(
  typeof range==='string'?range:'');
 if(!m)return null;
 const from=Number(m[1]),to=Number(m[2]);
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
    to<from||to>=total||to-from+1>DEVICE_QA_MAX_RANGE)return null;
 return {from,to,size:to-from+1};
}

export async function forwardOwnerDeviceQaPlayback({
 req,res,runId,env=process.env,requestHub,now=Date.now
}={}){
 if(!enabledOwnerDeviceQa(env))return body(res,404,'device_qa_disabled');
 if(!isDeviceQaRun(runId)||!['GET','HEAD'].includes(req.method)||
    String(req.url||'').includes('?'))
  return body(res,404,'device_qa_route_invalid');
 const authorization=req.headers.authorization;
 const m=/^Bearer ([A-Za-z0-9._-]{40,600})$/.exec(
  typeof authorization==='string'?authorization:'');
 if(!m||!verifyOwnerDeviceQaTicket({
  secret:env.BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY,ticket:m[1],
  runId,now:now()
 }))return body(res,401,'device_qa_authorization_required');
 if(typeof requestHub!=='function')return body(res,503,'device_qa_bridge_unavailable');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),90000);timeout.unref?.();
 const onClose=()=>controller.abort();
 res.once('close',onClose);
 let upstream;
 try{
  const path='/internal/episodes/playback/'+runId;
  const head=await requestHub(path,{method:'HEAD',signal:controller.signal});
  const bytes=Number(head.headers.get('content-length'));
  const mime=String(head.headers.get('content-type')||'');
  if(head.status!==200||!Number.isSafeInteger(bytes)||bytes<1||
     bytes>4*1024**3||!MIME.has(mime))
   return body(res,404,'device_qa_verified_episode_missing');
  const headers={
   'content-type':mime,'accept-ranges':'bytes','cache-control':'private,no-store',
   'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
   'cross-origin-resource-policy':'same-origin',
   'content-disposition':'inline'
  };
  if(req.method==='HEAD'){
   res.writeHead(200,{...headers,'content-length':String(bytes)});
   return res.end();
  }
  const selected=strictDeviceQaRange(req.headers.range,bytes);
  if(!selected)return body(res,416,'device_qa_explicit_bounded_range_required');
  upstream=await requestHub(path,{method:'GET',range:
   'bytes='+selected.from+'-'+selected.to,signal:controller.signal});
  if(upstream.status!==206||!upstream.body||
     upstream.headers.get('content-range')!==
      'bytes '+selected.from+'-'+selected.to+'/'+bytes||
     Number(upstream.headers.get('content-length'))!==selected.size||
     upstream.headers.get('content-type')!==mime)
   return body(res,503,'device_qa_private_range_invalid');
  res.writeHead(206,{...headers,'content-length':String(selected.size),
   'content-range':'bytes '+selected.from+'-'+selected.to+'/'+bytes});
  let sent=0;
  for await(const chunk of upstream.body){
   if(controller.signal.aborted)throw Error('device_qa_aborted');
   sent+=chunk.byteLength;
   if(sent>selected.size)throw Error('device_qa_overrun');
   if(!res.write(chunk))await once(res,'drain',{signal:controller.signal});
  }
  if(sent!==selected.size)throw Error('device_qa_short_response');
  return res.end();
 }catch{
  if(res.headersSent){if(!res.destroyed)res.destroy()}
  else if(!res.destroyed)body(res,503,'device_qa_stream_unavailable');
 }finally{
  clearTimeout(timeout);res.off('close',onClose);
  try{await upstream?.body?.cancel?.()}catch{}
 }
}
