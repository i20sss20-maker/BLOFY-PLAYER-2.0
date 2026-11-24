import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';

// Both endpoints fail closed unless explicitly enabled. Issue is accessible only
// behind the existing authenticated STREAM bridge. Redemption is a separate
// mobile API, never a legacy subscription redemption fallback.
export function createConnectHttp({pairing,enabled=false}={}){
 const issueLimit=createFixedWindowLimiter({limit:20,windowMs:60000,maxEntries:1000});
 const redeemLimit=createFixedWindowLimiter({limit:8,windowMs:60000,maxEntries:2000});
 const globalIssue=createFixedWindowLimiter({limit:60,windowMs:60000,maxEntries:1});
 const globalRedeem=createFixedWindowLimiter({limit:120,windowMs:60000,maxEntries:1});
 const allowed=new Set(['connect_input_invalid','connect_host_invalid','connect_code_invalid','connect_code_expired_or_used','connect_capacity','connect_rate_limited','connect_disabled','connect_pairing_unavailable','connect_key_unconfigured','connect_store_unconfigured']);
 function reply(res,status,body,extra={}){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra});res.end(JSON.stringify(body));
 }
 async function handle(req,res,{operation,bridgeAuthorized=false}={}){
  if(operation!=='issue'&&operation!=='redeem')return false;
  if(operation==='issue'&&!bridgeAuthorized){reply(res,401,{ok:false,code:'connect_unauthorized'});return true}
  if(req.method!=='POST'||String(req.url||'').includes('?')){reply(res,405,{ok:false,code:'connect_method_denied'},{allow:'POST'});return true}
  if(enabled!==true){reply(res,503,{ok:false,code:'connect_disabled'});return true}
  const isIssue=operation==='issue',limiter=isIssue?issueLimit:redeemLimit;
  const local=limiter.consume(requestClientKey(req)),global=(isIssue?globalIssue:globalRedeem).consume('all');
  if(!local.allowed||!global.allowed){reply(res,429,{ok:false,code:'connect_rate_limited'},{'retry-after':String(Math.max(local.retryAfterSeconds,global.retryAfterSeconds))});return true}
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type']||''))){reply(res,415,{ok:false,code:'connect_json_required'});return true}
  try{
   const chunks=[];let size=0;
   for await(const raw of req){const buf=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=buf.length;if(size>4096){reply(res,413,{ok:false,code:'connect_payload_too_large'});return true}chunks.push(buf)}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{reply(res,400,{ok:false,code:'connect_input_invalid'});return true}
   if(!input||typeof input!=='object'||Array.isArray(input)){reply(res,400,{ok:false,code:'connect_input_invalid'});return true}
   const result=isIssue?await pairing.issue({host:input.host,username:input.username,password:input.password,...(input.allowHttp===true?{allowHttp:true}:{}),...(input.numericCode===true?{numericCode:true}:{}),...(input.shortCode===true?{shortCode:true}:{})}):await pairing.redeem({code:input.code});
   reply(res,isIssue?201:200,result);
  }catch(e){
   const code=allowed.has(e?.message)?e.message:'connect_pairing_unavailable';
   const status=allowed.has(e?.message)&&[400,404,429,503].includes(e.status)?e.status:503;
   reply(res,status,{ok:false,code});
  }
  return true;
 }
 return {handle};
}
