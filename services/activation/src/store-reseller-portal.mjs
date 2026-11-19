// BLOFY STORE PRO reseller portal — dedicated scoped browser gateway.
// Never forwards browser-supplied owner credentials or arbitrary internal URLs.
// All reseller ownership, credit charging and issuance are implemented by the
// existing stream-distributors engine behind a private, fixed internal bridge.
import {createFixedWindowLimiter} from './auth-protection.mjs';

export const RESELLER_API_PREFIX='/api/v1/store/reseller/';
const COOKIE='__Host-blofy_reseller';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const ALLOWED_ORIGINS=new Set([
 'https://blofyplayer.com','https://www.blofyplayer.com'
]);
const COMMANDS=new Set([
 'login','logout','me','analytics','list','activity','clients','reveal',
 'issue','renew','relogin','customer','change-password','rotate-xtream'
]);
const EXPOSED_ERRORS=new Set([
 'distributor_login_failed','distributor_unauthorized','distributor_session_expired',
 'distributor_plan_invalid','distributor_days_invalid','distributor_issue_id_invalid',
 'distributor_invalid_name_or_username','distributor_issue_missing','distributor_issue_not_ready',
 'distributor_credits_insufficient','distributor_insufficient_credits',
 'distributor_daily_limit_exceeded','distributor_relogin_unavailable',
 'distributor_rotation_requires_confirmation','distributor_password_strength_invalid',
 'distributor_password_current_invalid','distributor_password_reused',
 'distributor_trial_phone_required','distributor_trial_not_allowed',
 'distributor_issue_not_eligible','distributor_rotation_cooldown'
]);
const COMMON_HEADERS={
 'cache-control':'no-store, private','pragma':'no-cache',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
};
export const resellerPortalCsp=[
 "default-src 'none'","script-src 'self'","style-src 'self'",
 "img-src 'self' data:","connect-src 'self'","base-uri 'none'",
 "form-action 'self'","frame-ancestors 'none'"
].join('; ');

function errorCode(message){
 const code=String(message||'');
 return EXPOSED_ERRORS.has(code)?code:'reseller_request_failed';
}
export function resellerCookie(token,remove=false){
 const value=remove?'':String(token||'');
 return COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict'
   +'; Max-Age='+(remove?'0':'43200');
}
export function resellerTokenFromCookie(header){
 const source=String(header||'').slice(0,8192);
 // Duplicate cookies are rejected, rather than allowing proxy/parser disagreement.
 const values=source.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
 if(values.length!==1)return null;
 const token=values[0].slice(COOKIE.length+1);
 return TOKEN.test(token)?token:null;
}
function noStoreJson(json,res,status,payload,extra={}){
 json(res,status,payload,{...COMMON_HEADERS,...extra});
}
export function createStoreResellerPortal({
 json,readJson,fetchImpl=globalThis.fetch,env=process.env,
 port=Number(env.PORT||3000),now=Date.now
}={}){
 if(typeof json!=='function'||typeof readJson!=='function'||typeof fetchImpl!=='function')
   throw Error('reseller_portal_dependencies_invalid');
 const bridge=String(env.BLOFY_STREAM_UNIFIED_BRIDGE_KEY||'');
 const ready=bridge.length>=24&&Number.isSafeInteger(port)&&port>=1024&&port<=65535;
 const perClient=createFixedWindowLimiter({limit:40,windowMs:60000,maxEntries:6000});
 const logins=createFixedWindowLimiter({limit:7,windowMs:10*60000,maxEntries:5000});
 const totalLogins=createFixedWindowLimiter({limit:160,windowMs:60000,maxEntries:1});
 return async function resellerPortal(req,res,url){
  const path=url?.pathname||'';
  if(!path.startsWith(RESELLER_API_PREFIX))return false;
  const command=path.slice(RESELLER_API_PREFIX.length);
  if(!COMMANDS.has(command)||command.includes('/')){
   noStoreJson(json,res,404,{ok:false,error:'not_found'});return true;
  }
  if(req.method!=='POST'){
   noStoreJson(json,res,405,{ok:false,error:'method_not_allowed'},
     {allow:'POST'});return true;
  }
  // A cross-site form cannot set our JSON+custom-header combination.
  if(!ALLOWED_ORIGINS.has(String(req.headers?.origin||''))||
      req.headers?.['x-blofy-reseller']!=='1'){
   noStoreJson(json,res,403,{ok:false,error:'origin_not_allowed'});return true;
  }
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
    String(req.headers?.['content-type']||''))){
   noStoreJson(json,res,415,{ok:false,error:'content_type_invalid'});return true;
  }
  const contentLength=Number(req.headers?.['content-length']||0);
  if(!Number.isFinite(contentLength)||contentLength>4000){
   noStoreJson(json,res,413,{ok:false,error:'request_too_large'});return true;
  }
  if(!ready){
   noStoreJson(json,res,503,{ok:false,error:'reseller_service_not_configured'});return true;
  }
  // Do not trust forwarded IP headers to identify a client or supply rate-limit keys.
  const remote=String(req.socket?.remoteAddress||'unknown').slice(0,120);
  const key=remote+':'+command;
  const budget=perClient.consume(key,now());
  const loginBudget=command==='login'?logins.consume(key,now()):{allowed:true};
  const global=command==='login'?totalLogins.consume('global',now()):{allowed:true};
  if(!budget.allowed||!loginBudget.allowed||!global.allowed){
   noStoreJson(json,res,429,{ok:false,error:'rate_limited'},
     {'retry-after':String(Math.max(budget.retryAfterSeconds||0,
       loginBudget.retryAfterSeconds||0,global.retryAfterSeconds||0,1))});
   return true;
  }
  const session=resellerTokenFromCookie(req.headers?.cookie);
  if(!session&&!['login','logout'].includes(command)){
   noStoreJson(json,res,401,{ok:false,error:'reseller_login_required'});return true;
  }
  let input;
  try{
   input=await readJson(req);
   if(!input||typeof input!=='object'||Array.isArray(input)||
      Buffer.byteLength(JSON.stringify(input))>4000)
     throw Error('invalid_payload');
  }catch{
   noStoreJson(json,res,400,{ok:false,error:'invalid_json'});return true;
  }
  // Prevent request bodies from injecting an admin key or a different distributor session.
  const {sessionToken:discarded,adminToken:discardedAdmin,authorization:discardedAuth,
    ...customerInput}=input;
  if(command==='logout'&&!session){
   noStoreJson(json,res,200,{ok:true},
     {'set-cookie':resellerCookie('',true)});return true;
  }
  if(command==='login'){
   if(typeof customerInput.username!=='string'||typeof customerInput.password!=='string'||
      customerInput.username.length>32||customerInput.password.length>200){
    noStoreJson(json,res,400,{ok:false,error:'reseller_credentials_invalid'});return true;
   }
  }
  const body=command==='login'?{
   username:customerInput.username,password:customerInput.password
  }:{...customerInput,sessionToken:session};
  const pathToInternal='/internal/blofy-stream/distributor/'+command;
  try{
   // Fixed localhost destination, fixed command enum, server-only owner bridge key.
   const response=await fetchImpl('http://127.0.0.1:'+port+pathToInternal,{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(11000),
    headers:{authorization:'Bearer '+bridge,'content-type':'application/json',
      accept:'application/json'},body:JSON.stringify(body)
   });
   if(Number(response.headers?.get?.('content-length')||0)>160000)
    throw Error('reseller_bridge_response_large');
   // Decode body with a hard cap even if upstream has no Content-Length.
   const responseText=await response.text();
   if(Buffer.byteLength(responseText,'utf8')>160000)
    throw Error('reseller_bridge_response_large');
   const upstream=JSON.parse(responseText);
   if(!response.ok||upstream?.ok!==true){
    const status=[400,401,403,404,409,429].includes(response.status)?
      response.status:503;
    const headers= status===401&&session?
      {'set-cookie':resellerCookie('',true)}:{};
    noStoreJson(json,res,status,{ok:false,error:errorCode(upstream?.code||upstream?.error)},headers);
    return true;
   }
   if(command==='login'){
    if(!TOKEN.test(String(upstream.token||'')))throw Error('reseller_missing_token');
    noStoreJson(json,res,200,{ok:true,item:upstream.item},
      {'set-cookie':resellerCookie(upstream.token)});return true;
   }
   if(command==='logout'){
    noStoreJson(json,res,200,{ok:true},
      {'set-cookie':resellerCookie('',true)});return true;
   }
   // Never expose an internal bearer/session token, even if upstream changes.
   const {token:privateToken,sessionToken:privateSession,...safeData}=upstream;
   noStoreJson(json,res,200,safeData);
  }catch{
   // Never leak the server bridge key, raw customer input or internal errors.
   noStoreJson(json,res,503,{ok:false,error:'reseller_temporarily_unavailable'});
  }
  return true;
 };
}
