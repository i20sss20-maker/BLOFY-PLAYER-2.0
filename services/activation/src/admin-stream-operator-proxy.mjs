// BLOFY STREAM operator reverse proxy (same-origin administration).
// Uses a dedicated server-to-server credential, NEVER browser localStorage,
// cookies, query params, HTML or client-side fetch to the external Railway host.
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const ORIGIN='https://blofy-stream-api-production.up.railway.app';
const MAX_REQUEST_BYTES=64*1024;
const REQUEST_TIMEOUT_MS=185000;
const HEADER_ALLOWLIST=[
  'content-type','content-range','accept-ranges','content-length',
  'content-disposition','etag','last-modified','content-security-policy',
  'x-frame-options','x-content-type-options','referrer-policy',
  'x-blofy-timeline-source','x-blofy-timeline-index','x-blofy-timeline-offset'
];
export function operatorProxyPath(path) {
  return path==='/operator'||path==='/operator/'||path.startsWith('/operator/api/');
}
export function operatorProxyMethod(method,path) {
  return (method==='GET'||method==='HEAD'||(method==='POST'&&path.startsWith('/operator/api/')))
    && operatorProxyPath(path);
}
export function operatorProxyTarget(requestUrl,overridePath=''){
  // Never resolve a user-supplied host. Only the approved STREAM operator service.
  const parsed=new URL(requestUrl,'http://localhost');
  const path=overridePath||parsed.pathname;
  if(!operatorProxyPath(path))throw Error('invalid_operator_path');
  const target=new URL(ORIGIN);
  target.pathname=path;
  target.search=parsed.search;
  return target.toString();
}
async function readBoundedBody(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_REQUEST_BYTES)throw Object.assign(Error('body_too_large'),{code:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function respond(res,status,message){
  const body=Buffer.from(JSON.stringify({ok:false,code:message}));
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'content-length':body.length,
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'x-robots-tag':'noindex'
  });
  res.end(body);
}
export async function proxyStreamOperator(req,res,{
  secret=process.env.BLOFY_STREAM_OPERATOR_PROXY_TOKEN||'',
  fetchImpl=fetch,
  pathOverride=''
}={}){
  const uri=new URL(req.url||'/','http://localhost');
  const path=pathOverride||uri.pathname;
  if(!operatorProxyMethod(req.method,path))return respond(res,405,'operator_method_not_allowed');
  if(typeof secret!=='string'||secret.length<40)return respond(res,503,'operator_proxy_not_configured');
  const upstream=operatorProxyTarget(req.url||'/',path);
  const controller=new AbortController();
  const onClose=()=>{if(!res.writableFinished)controller.abort();};
  res.once('close',onClose);
  let timer;
  try{
    const headers={
      authorization:'Basic '+Buffer.from('operator:'+secret).toString('base64'),
      accept:String(req.headers.accept||'*/*').slice(0,200),
      'accept-encoding':'identity',
      'user-agent':'BLOFY-Admin-Operator-Proxy/1.0'
    };
    for(const header of ['content-type','range','if-range','if-none-match','if-modified-since','x-blofy-operator-action']){
      const value=req.headers[header];
      if(typeof value==='string'&&value.length<=300)headers[header]=value;
    }
    const body=req.method==='POST'?await readBoundedBody(req):undefined;
    if(body && body.length>0)headers['content-length']=String(body.length);
    timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    const reply=await fetchImpl(upstream,{
      method:req.method,
      headers,
      body,
      redirect:'manual',
      signal:controller.signal
    });
    // Never expose the backend's Basic-auth prompt to browsers.
    if(reply.status===401||reply.status===403){
      try{await reply.body?.cancel();}catch{}
      return respond(res,502,'operator_bridge_auth_failed');
    }
    // Do not forward any redirects to media providers or external hosts.
    if(reply.status>=300&&reply.status<400 && reply.status!==304){
      try{await reply.body?.cancel();}catch{}
      return respond(res,502,'operator_upstream_redirect_not_allowed');
    }
    const forward={
      'cache-control':'no-store, private',
      'x-robots-tag':'noindex',
      'x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer'
    };
    for(const name of HEADER_ALLOWLIST){
      const value=reply.headers.get(name);
      if(value!==null)forward[name]=value;
    }
    // Drop transfer/content encoding, hop-by-hop and Set-Cookie. A partial
    // video response retains Content-Range and Accept-Ranges for the player.
    if(req.method==='HEAD'||reply.status===204||reply.status===304||!reply.body){
      res.writeHead(reply.status,forward);
      res.end();
      try{await reply.body?.cancel();}catch{}
      return;
    }
    res.writeHead(reply.status,forward);
    await pipeline(Readable.fromWeb(reply.body),res);
  }catch(error){
    if(!res.headersSent&&!res.writableEnded){
      respond(res,error?.code===413?413:502,error?.code===413?'operator_request_too_large':'operator_proxy_unavailable');
    }else if(!res.writableEnded)res.destroy();
  }finally{
    if(timer)clearTimeout(timer);
    res.off('close',onClose);
  }
}


// The reseller portal keeps its own independently authenticated HttpOnly
// session cookie scoped to /distributor. Public login page as on STREAM.
// Never forward BLOFY admin cookies, and reject cross-site POST in the caller.
export function distributorProxyPath(path) {
  return path==='/distributor'||path==='/distributor/'||path.startsWith('/distributor/api/');
}
export function distributorProxyMethod(method,path) {
  return (method==='GET'&&(path==='/distributor'||path==='/distributor/'))||
    (method==='POST'&&path.startsWith('/distributor/api/'));
}
export async function proxyStreamDistributor(req,res,{fetchImpl=fetch}={}){
  const uri=new URL(req.url||'/','http://localhost');
  const path=uri.pathname;
  if(!distributorProxyMethod(req.method,path))
    return respond(res,405,'distributor_method_not_allowed');
  const destination=new URL(ORIGIN);
  destination.pathname=path;destination.search=uri.search;
  const controller=new AbortController();
  const onClose=()=>{if(!res.writableFinished)controller.abort();};
  res.once('close',onClose);
  let timer;
  try{
    const headers={
      accept:String(req.headers.accept||'*/*').slice(0,200),
      'accept-encoding':'identity',
      'user-agent':'BLOFY-Reseller-Website-Proxy/1.0'
    };
    if(req.method==='POST'){
      // STREAM's distributor CSRF gate compares Origin to Host. The site must
      // validate the browser's true Origin before this trusted rewrite.
      headers.origin=ORIGIN;
      for(const name of ['content-type','x-blofy-distributor-action']){
        const value=req.headers[name];
        if(typeof value==='string'&&value.length<=300)headers[name]=value;
      }
      const session=String(req.headers.cookie||'').match(/(?:^|;\s*)blofy_dist=([A-Za-z0-9_-]{43})(?:;|$)/);
      if(session)headers.cookie='blofy_dist='+session[1];
    }
    const body=req.method==='POST'?await readBoundedBody(req):undefined;
    if(body&&body.length>0)headers['content-length']=String(body.length);
    timer=setTimeout(()=>controller.abort(),45000);
    const reply=await fetchImpl(destination.toString(),{
      method:req.method,headers,body,redirect:'manual',signal:controller.signal
    });
    if(reply.status>=300&&reply.status<400&&reply.status!==304){
      try{await reply.body?.cancel();}catch{}
      return respond(res,502,'distributor_upstream_redirect_not_allowed');
    }
    const forward={
      'cache-control':'no-store, private','x-robots-tag':'noindex',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
    };
    for(const name of HEADER_ALLOWLIST){
      const value=reply.headers.get(name);
      if(value!==null)forward[name]=value;
    }
    const upstreamCookie=reply.headers.get('set-cookie');
    if(upstreamCookie && /^blofy_dist=[A-Za-z0-9_-]*;\s*Path=\/distributor;\s*Max-Age=\d+;\s*HttpOnly;\s*Secure;\s*SameSite=Strict\s*$/i.test(upstreamCookie))
      forward['set-cookie']=upstreamCookie;
    if(!reply.body||reply.status===204||reply.status===304){
      res.writeHead(reply.status,forward);res.end();
      try{await reply.body?.cancel();}catch{}
      return;
    }
    res.writeHead(reply.status,forward);
    await pipeline(Readable.fromWeb(reply.body),res);
  }catch(error){
    if(!res.headersSent&&!res.writableEnded)
      respond(res,error?.code===413?413:502,error?.code===413?'distributor_request_too_large':'distributor_proxy_unavailable');
    else if(!res.writableEnded)res.destroy();
  }finally{
    if(timer)clearTimeout(timer);
    res.off('close',onClose);
  }
}
