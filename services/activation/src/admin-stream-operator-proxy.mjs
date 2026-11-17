// BLOFY STREAM operator reverse proxy (same-origin administration).
// Uses a dedicated server-to-server credential, NEVER browser localStorage,
// cookies, query params, HTML or client-side fetch to the external Railway host.
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const ORIGIN='https://blofy-stream-api-production.up.railway.app';
const MAX_REQUEST_BYTES=64*1024;
const OWNER_SAMPLE_PATH='/operator/api/media-scan/owner-sample';
const OWNER_SAMPLE_MAX_BYTES=2_000_000;
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
export function operatorProxyBodyLimit(path){
  return path===OWNER_SAMPLE_PATH?OWNER_SAMPLE_MAX_BYTES:MAX_REQUEST_BYTES;
}
async function readBoundedBody(req,maxBytes=MAX_REQUEST_BYTES) {
  const rawLength=req.headers?.['content-length'];
  const strict=maxBytes===OWNER_SAMPLE_MAX_BYTES;
  if((strict&&typeof rawLength!=='string')||
    (rawLength!==undefined&&
     (!/^[0-9]{1,8}$/.test(String(rawLength))||
      Number(rawLength)>maxBytes)))
    throw Object.assign(Error('body_too_large'),{code:413});
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes)throw Object.assign(Error('body_too_large'),{code:413});
    chunks.push(chunk);
  }
  if(rawLength!==undefined&&size!==Number(rawLength))
    throw Object.assign(Error('body_length_mismatch'),{code:400});
  return Buffer.concat(chunks,size);
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
function operatorUnavailablePage(res,status,code,path) {
  // A navigation-only fallback for the HTML admin page; API/media retain JSON.
  if(path!=='/operator'&&path!=='/operator/')return respond(res,status,code);
  const body=[
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow"><title>BLOFY | تعذر فتح لوحة STREAM</title>',
    '<style>body{margin:0;font-family:system-ui,Tahoma,Arial;background:#0b1321;color:#eaf3ff;min-height:100dvh;display:grid;place-items:center;padding:20px}',
    'main{max-width:690px;width:100%;background:#17253b;border:1px solid #405474;border-radius:20px;padding:clamp(20px,5vw,38px);box-shadow:0 24px 70px #0006}',
    'h1{font-size:clamp(23px,4vw,32px)}p{line-height:1.9;color:#bdcde0}',
    'a{display:inline-block;margin:8px 0 0 10px;padding:11px 17px;border-radius:12px;background:#245278;color:#fff;text-decoration:none}',
    'a:hover,a:focus-visible{outline:2px solid #9ed9ff}small{display:block;color:#839eba;margin-top:18px}</style></head>',
    '<body><main role="main"><strong>BLOFY CONTROL CENTER</strong>',
    '<h1>تعذر الاتصال بلوحة STREAM مؤقتًا</h1>',
    '<p>موقع BLOFY ما زال متاحًا، لكن صفحة إدارة STREAM لم تُفتح. لم نُعد إرسال أي أمر إدارة أو نُغيّر أكواد المشتركين.</p>',
    '<nav aria-label="خيارات الإدارة"><a href="/admin/control-center">↻ إعادة المحاولة</a>',
    '<a href="/admin">إدارة الموقع</a>',
    '<a href="/admin/control-center/health">فحص اتصال الخدمات</a></nav>',
    '<small>الرمز: ',code,' • HTTP ',String(status),
    ' • لا يتضمن هذا التقرير معلومات دخول أو روابط المصادر.</small>',
    '</main></body></html>'
  ].join('');
  res.writeHead(status,{
    'content-type':'text/html; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    'cache-control':'no-store, private',
    'x-robots-tag':'noindex',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    'x-frame-options':'DENY',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
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
  if(typeof secret!=='string'||secret.length<40)return operatorUnavailablePage(res,503,'operator_proxy_not_configured',path);
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
    const sampleUpload=path===OWNER_SAMPLE_PATH;
    if(sampleUpload && (req.headers['content-type']!=='video/mp2t'||
        req.headers['x-blofy-sample-rights']!=='confirmed'))
      return respond(res,403,'operator_sample_confirmation_required');
    if(sampleUpload)headers['x-blofy-sample-rights']='confirmed';
    const body=req.method==='POST'?
      await readBoundedBody(req,operatorProxyBodyLimit(path)):undefined;
    if(body && body.length>0)headers['content-length']=String(body.length);
    timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    const reply=await fetchImpl(upstream,{
      method:req.method,
      headers,
      body,
      redirect:'manual',
      signal:controller.signal
    });
    // A 401 means our server-to-server credential was denied. However, a
    // 403 from an authorized operator action is a legitimate policy failure,
    // not a broken bridge: preserve its status and sanitized upstream JSON.
    // Never forward WWW-Authenticate or Basic challenges to browsers.
    if(reply.status===401){
      try{await reply.body?.cancel();}catch{}
      return operatorUnavailablePage(res,502,'operator_bridge_auth_failed',path);
    }
    // Do not forward any redirects to media providers or external hosts.
    if(reply.status>=300&&reply.status<400 && reply.status!==304){
      try{await reply.body?.cancel();}catch{}
      return operatorUnavailablePage(res,502,'operator_upstream_redirect_not_allowed',path);
    }
    if(reply.status>=500&&(path==='/operator'||path==='/operator/')){
      try{await reply.body?.cancel()}catch{}
      return operatorUnavailablePage(res,502,'operator_service_unavailable',path);
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
      operatorUnavailablePage(res,error?.code===413?413:error?.code===400?400:502,
        error?.code===413?'operator_request_too_large':
        error?.code===400?'operator_request_length_invalid':'operator_proxy_unavailable',path);
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
