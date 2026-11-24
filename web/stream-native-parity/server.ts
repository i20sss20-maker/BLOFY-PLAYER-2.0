import {readCatalogPage} from './catalog-array-reader.mjs';
import { createCipheriv,createDecipheriv,createHmac,randomBytes } from 'node:crypto';
import {stableAccountProfileKey,legacyTokenProfileKey} from './web-profile-key.mjs';
import {createCatalogPageCache} from './catalog-page-cache.mjs';
const HTML=await Bun.file(new URL('./index.html',import.meta.url)).text()
const ORIGIN='https://blofyplayer.com';
const KEY_HEX=String(Bun.env.VIDAA_SESSION_KEY||'');
const KEY=/^[a-f0-9]{64}$/i.test(KEY_HEX)?Buffer.from(KEY_HEX,'hex'):null;
const CT='application/json; charset=utf-8';
function json(status,body,extra={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':CT,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})}
function seal(token){if(!KEY)throw new Error('SESSION_KEY_MISSING');const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',KEY,iv);const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url')}
function unseal(s){try{if(!KEY||!s)return null;const v=Buffer.from(s,'base64url');if(v.length<30||v.length>500)return null;const c=createDecipheriv('aes-256-gcm',KEY,v.subarray(0,12));c.setAuthTag(v.subarray(12,28));return Buffer.concat([c.update(v.subarray(28)),c.final()]).toString('utf8')}catch{return null}}
function token(req){const m=String(req.headers.get('cookie')||'').match(/(?:^|;\s*)bv_session=([^;]+)/);return m?unseal(m[1]):null}
function auth(req){const t=token(req);return t?{'Authorization':'Bearer '+t,'Accept':'application/json','Cache-Control':'no-store'}:null}
function verifiedWorkerRetryHeaders(headers){
 // Only numeric short delays are forwarded from the fixed private worker.
 // Never forward arbitrary media headers, URLs, upstream hostnames or secrets.
 const seconds=Number(headers&&headers.get&&headers.get('retry-after')||0);
 return Number.isInteger(seconds)&&seconds>=1&&seconds<=30?
  {'Retry-After':String(seconds)}:{}
}
function noCache(extra={}){return {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}}
function normalizeSearch(text){
 return String(text||'').toLowerCase().normalize('NFKC')
  .replace(/[\u064b-\u065f\u0670\u0640]/g,'')
  .replace(/[\u0622\u0623\u0625\u0671]/g,'ا')
  .replace(/\u0649/g,'ي').replace(/\u0624/g,'و').replace(/\u0626/g,'ي')
}
const catalogPageCache=createCatalogPageCache();
const allowed=new Set(['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams','get_series_categories','get_series','get_vod_info','get_series_info','get_short_epg','get_blofy_catalog_version']);
const server=Bun.serve({port:Number(Bun.env.PORT||3000),idleTimeout:255,async fetch(req){
const u=new URL(req.url);const p=u.pathname;const method=req.method;

if(method==='GET'&&(p==='/app.js'||p==='/profile-transfer.js'||p==='/playback-acceptance.js'||p==='/styles.css'||p==='/manifest.webmanifest'||p==='/stream-icon.svg'||p==='/sw.js')){
 const file=p.slice(1);
 const mime=p==='/app.js'||p==='/profile-transfer.js'||p==='/playback-acceptance.js'||p==='/sw.js'?'application/javascript; charset=utf-8':p==='/styles.css'?'text/css; charset=utf-8':p==='/stream-icon.svg'?'image/svg+xml':'application/manifest+json; charset=utf-8';
 const asset=Bun.file(new URL('./'+file,import.meta.url));
 if(!await asset.exists())return json(404,{error:'static_asset_missing'});
 return new Response(asset,{headers:noCache({'Content-Type':mime,...(p==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})})});
}
if(p==='/'&&method==='GET')return new Response(HTML,{status:200,headers:noCache({'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"})});


if(p==='/app.webmanifest'&&method==='GET'){
 return new Response(JSON.stringify({id:'/',name:'BLOFY STREAM',short_name:'BLOFY',description:'BLOFY STREAM الرسمي عبر المتصفح والتلفزيون',start_url:'/',scope:'/',display:'standalone',orientation:'landscape',background_color:'#09090c',theme_color:'#0b0b10',lang:'ar',dir:'rtl',icons:[{src:'/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]}),{headers:{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'public,max-age=3600'}})
}
if(p==='/app-icon.svg'&&method==='GET')return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"512\" height=\"512\" viewBox=\"0 0 512 512\"><defs><linearGradient id=\"g\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\"><stop stop-color=\"#49303a\"/><stop offset=\"1\" stop-color=\"#080a0f\"/></linearGradient></defs><rect width=\"512\" height=\"512\" rx=\"96\" fill=\"url(#g)\"/><rect x=\"40\" y=\"40\" width=\"432\" height=\"432\" rx=\"72\" fill=\"none\" stroke=\"#d6ad79\" stroke-width=\"8\"/><text x=\"256\" y=\"270\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"121\" font-weight=\"bold\" letter-spacing=\"5\" fill=\"#efc587\">BLOFY</text><text x=\"256\" y=\"331\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"44\" letter-spacing=\"18\" fill=\"#e8c18d\">STREAM</text></svg>",{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'}});

if(p==='/health'&&method==='GET')return json(KEY?200:503,{ok:Boolean(KEY),app:'blofy-stream-web',ready:Boolean(KEY),version:'1.0.0'});

if(p==='/vendor/mpegts.js'&&method==='GET'){
 // Serve the pinned, locally packaged JS player. No dependence on a third-
 // party CDN at playback time; avoids extra DNS/TLS and blocked-TV outages.
 const engine=Bun.file(new URL('./node_modules/mpegts.js/dist/mpegts.js',import.meta.url));
 if(!await engine.exists())return json(503,{error:'video_engine_unavailable'});
 return new Response(engine,{status:200,headers:{
  'Content-Type':'application/javascript; charset=utf-8',
  'Cache-Control':'public,max-age=86400',
  'X-Content-Type-Options':'nosniff'
 }});
}

if(!KEY)return json(503,{ok:false,error:'service_not_configured'});
if(p==='/api/logout'&&method==='POST')return json(200,{ok:true},{'Set-Cookie':'bv_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
if(p==='/api/redeem'&&method==='POST'){
 let input={};try{if(Number(req.headers.get('content-length')||0)>2048)return json(413,{error:'invalid_payload'});input=await req.json()}catch{return json(400,{error:'invalid_payload'})}
 const code=String(input.code||'').toUpperCase().trim();const key=String(input.deviceKey||'');
 if(!/^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(code)||!/^[a-f0-9]{64}$/.test(key))return json(400,{error:'كود أو جهاز غير صالح'});
 try{const r=await fetch(ORIGIN+'/api/v1/stream/app/redeem',{method:'POST',headers:{'Content-Type':CT,'Accept':'application/json'},body:JSON.stringify({code,deviceKey:key}),redirect:'manual',signal:AbortSignal.timeout(20000)});
 let v={};try{v=await r.json()}catch{}if(!r.ok||!v.ok||typeof v.accessToken!=='string'||!/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(v.accessToken))return json(r.status===409?409:r.status===429?429:400,{ok:false,error:r.status===409?'الكود مستخدم أو مربوط بجهاز آخر':r.status===429?'محاولات كثيرة، حاول لاحقًا':'تعذّر تفعيل الكود'});
 return json(200,{ok:true,activatedAt:v.account?.activatedAt||null,expiresAt:v.account?.expiresAt||null,
   profileKey:stableAccountProfileKey(v.accessToken,KEY),legacyProfileKey:legacyTokenProfileKey(v.accessToken,KEY)},{'Set-Cookie':'bv_session='+seal(v.accessToken)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000'});
 }catch(e){return json(502,{error:'تعذّر الاتصال بخادم التفعيل'})}
}
if(p==='/vendor/hls.min.js'&&method==='GET'){
 const asset=Bun.file(new URL('./node_modules/hls.js/dist/hls.min.js',import.meta.url));
 if(!await asset.exists())return json(503,{error:'hls_player_not_installed'});
 return new Response(asset,{status:200,headers:{
  'Content-Type':'application/javascript; charset=utf-8',
  'Cache-Control':'public,max-age=3600',
  'X-Content-Type-Options':'nosniff'
 }});
}

const h=auth(req);if(!h)return json(401,{ok:false,error:'activation_required'});
if(p==='/api/ai/interpret'&&method==='POST'){
 // Same authenticated first-party gateway used by native STREAM Android.
 // Credentials remain server-side in the encrypted HttpOnly session cookie.
 if(!h)return json(401,{ok:false,error:'activation_required'});
 let payload={};
 try{
  if(Number(req.headers.get('content-length')||0)>2048)return json(413,{ok:false,error:'request_too_large'});
  payload=await req.json()
 }catch{return json(400,{ok:false,error:'invalid_request'})}
 const text=String(payload.text||'').trim().slice(0,160),locale=payload.locale==='en'?'en':'ar';
 if(text.length<3||text.length>160)return json(400,{ok:false,error:'invalid_ai_query'});
 try{
  const endpoint='https://blofy-ai-gateway-production.up.railway.app/v1/search/interpret';
  const response=await fetch(endpoint,{method:'POST',redirect:'manual',headers:{
   'Content-Type':'application/json; charset=utf-8','Authorization':h.Authorization,'Accept':'application/json',
   'Cache-Control':'no-store'},body:JSON.stringify({text,locale}),signal:AbortSignal.timeout(24000)});
  if(response.status>=300&&response.status<400)return json(502,{ok:false,error:'ai_redirect_rejected'});
  if(!response.ok)return json([401,403,429].includes(response.status)?response.status:503,
   {ok:false,error:response.status===429?'ai_rate_limit':response.status===401||response.status===403?'subscription_expired':'ai_unavailable'});
  const raw=await response.text();
  if(raw.length>32000)return json(502,{ok:false,error:'ai_response_too_large'});
  let data;try{data=JSON.parse(raw)}catch{return json(502,{ok:false,error:'ai_bad_response'})}
  if(!data||data.ok!==true)return json(502,{ok:false,error:'ai_bad_response'});
  const clean=(v,max)=>typeof v==='string'?v.slice(0,max):'';
  return json(200,{ok:true,reply:clean(data.reply,240),intent:clean(data.intent,30),title:clean(data.title,110),
   genre:clean(data.genre,35),person:clean(data.person,90),
   year:Number.isInteger(Number(data.year))&&Number(data.year)>=1900&&Number(data.year)<=2035?Number(data.year):null,
   suggestedTitles:(Array.isArray(data.suggestedTitles)?data.suggestedTitles:[])
    .filter(x=>typeof x==='string'&&x.trim().length>=3).slice(0,12).map(x=>x.trim().slice(0,105))})
 }catch{return json(503,{ok:false,error:'ai_unavailable'})}
}
if(p==='/api/health/media'&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 // Authenticated read-only status; do not expose the media gateway secret.
 const secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^[a-f0-9]{64}$/i.test(secret))return json(503,{ok:false,player:'unconfigured'});
 try{
  const res=await fetch('http://blofy-stream-web-media.railway.internal:8080/health',
   {headers:{'X-Compat-Secret':secret},redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!res.ok)return json(503,{ok:false,player:'unavailable'});
  const info=await res.json();
  const ok=info.ok===true&&info.vodSeek?.ok===true&&info.hls?.ok===true;
  const used=Math.max(0,Number(info.activeJobs)||0),limit=Math.max(0,Number(info.limit)||0);
  return json(ok?200:503,{ok,player:ok?'ready':'degraded',vodSeek:info.vodSeek?.ok===true,
   hls:info.hls?.ok===true,converting:Math.round(used),capacity:Math.round(limit)});
 }catch{return json(503,{ok:false,player:'unreachable'})}
}
if(p==='/api/player-diagnostic'&&method==='POST'){
 let data;try{if(Number(req.headers.get('content-length')||0)>700)return json(413,{error:'too_large'});data=await req.json()}catch{return json(400,{error:'invalid_diagnostic'})}
 const kind=String(data?.kind||''),mode=String(data?.mode||''),phase=String(data?.phase||''),errorCode=Number(data?.errorCode)||0;
 if(!['live','movie','series'].includes(kind)||
  !['direct','audio','video','fullvod','vodhls','hls','mpegts'].includes(mode)||
  !['media_error','mpegts_error','startup_timeout','play_rejected','hls_error','vod_fallback','vod_full_start','vod_retry','vod_seek_request','vod_seek_ready','vod_seek_timeout'].includes(phase)||
  errorCode<0||errorCode>9)return json(400,{error:'invalid_diagnostic'});
 const rawId=String(data?.itemId||'');
 const itemRef=/^[1-9][0-9]{0,14}$/.test(rawId)&&KEY?
  createHmac('sha256',KEY).update(kind+':'+rawId).digest('hex').slice(0,12):null;
 const pos=Math.max(0,Math.min(21600,Math.round(Number(data?.position)||0)));
 const duration=Math.max(0,Math.min(21600,Math.round(Number(data?.duration)||0)));
 console.info('BLOFY_VIDAA_PLAYBACK_DIAG',{kind,mode,phase,errorCode,itemRef,position:pos,duration});
 return json(200,{ok:true});
}
if(p==='/api/session'&&method==='GET'){
 try{const r=await fetch(ORIGIN+'/api/v1/stream/app/session',{headers:h,redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok)return json(r.status===403?403:401,{active:false});const v=await r.json();return json(200,{ok:!!v.ok,active:!!v.active,daysRemaining:v.daysRemaining??null,expiresAt:v.expiresAt??null,
   profileKey:v.active?stableAccountProfileKey(token(req),KEY):null,
   legacyProfileKey:v.active?legacyTokenProfileKey(token(req),KEY):null})}catch{return json(502,{active:false,error:'session_unavailable'})}
}

if(p==='/api/page'&&method==='GET'){
 const k=u.searchParams.get('kind'),action=k==='live'?'get_live_streams':k==='movie'?'get_vod_streams':k==='series'?'get_series':null;
 if(!action)return json(400,{error:'invalid_kind'});
 const cat=u.searchParams.get('category_id')||'',query=normalizeSearch((u.searchParams.get('query')||'').trim().slice(0,75));
 if(cat&&!/^[0-9]{1,18}$/.test(cat))return json(400,{error:'invalid_category'});
 const offset=Math.max(0,Math.min(10000,parseInt(u.searchParams.get('offset')||'0',10)||0));
 const limit=Math.max(1,Math.min(48,parseInt(u.searchParams.get('limit')||'30',10)||30));
 // Only bounded browsing pages are eligible. Searches/credentials/media are
 // never cached. A manual refresh explicitly bypasses this 45s cache.
 const fresh=u.searchParams.get('fresh')==='1';
 const pageCacheable=!query&&offset<=108&&!req.signal.aborted;
 const pageCacheKey=pageCacheable?createHmac('sha256',KEY).update(
  'blofy-web-catalog-page-v1\0'+h.Authorization+'\0'+k+'\0'+cat+'\0'+offset+'\0'+limit
 ).digest('hex'):null;
 if(pageCacheKey&&!fresh){
  const pageHit=catalogPageCache.get(pageCacheKey);
  if(pageHit)return json(200,pageHit,{'X-Blofy-Catalog-Cache':'HIT'})
 }
 const target=new URL(ORIGIN+'/player_api.php');target.searchParams.set('action',action);
 if(cat)target.searchParams.set('category_id',cat);
 let upstream=null,reader=null;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),100000);
 const abort=()=>controller.abort();
 req.signal.addEventListener('abort',abort,{once:true});
 try{
  upstream=await fetch(target,{headers:{...h,'accept-encoding':'identity'},redirect:'manual',signal:controller.signal});
  if(!upstream.ok||!upstream.body)return json(upstream.status>=400?upstream.status:502,{error:'catalog_unavailable'});
  reader=upstream.body.getReader();
  const page=await readCatalogPage(reader,{offset,limit,match:item=>
   (!cat||String(item.category_id||'')===cat)&&(!query||normalizeSearch(item.name||item.title||'').includes(query))});
  try{await reader.cancel()}catch{}
  const result={...page,kind:k};
  if(pageCacheKey&&!req.signal.aborted)catalogPageCache.put(pageCacheKey,result);
  return json(200,result,{'X-Blofy-Catalog-Cache':'MISS'});
 }catch(e){try{await reader?.cancel()}catch{};return json(502,{error:'catalog_page_failed'})}
 finally{clearTimeout(timer);req.signal.removeEventListener('abort',abort)}
}

if(p==='/api/catalog'&&method==='GET'){
 const action=u.searchParams.get('action')||'';if(!allowed.has(action))return json(400,{error:'invalid_action'});
 const url=new URL(ORIGIN+'/player_api.php');url.searchParams.set('action',action);
 for(const x of ['category_id','series_id','vod_id','stream_id','limit']){const v=u.searchParams.get(x);if(v&&/^[0-9]{1,15}$/.test(v))url.searchParams.set(x,v)}
 try{const r=await fetch(url,{method:'GET',headers:{...h,'accept-encoding':'identity'},redirect:'manual',signal:AbortSignal.timeout(120000)});if(r.status>=300&&r.status<400)return json(502,{error:'unexpected_redirect'});return new Response(r.body,{status:r.status,headers:noCache({'Content-Type':'application/json; charset=utf-8'})})}catch{return json(502,{error:'catalog_upstream_failed'})}
}



if(p.startsWith('/api/vodfull/')&&(method==='GET'||method==='POST')){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/vodfull\/(movie|series)\/([1-9][0-9]{0,14})\/(mkv|mp4|avi|mov|ts)\/([0-3])\/([0-9]{3,5})\/(index\.m3u8|seg-[0-9]{6}\.ts|stop)$/);
 if(!match)return json(400,{error:'invalid_full_vod_path'});
 const duration=Number(match[5]);
 if(!Number.isSafeInteger(duration)||duration<120||duration>21600)return json(400,{error:'invalid_full_vod_duration'});
 const rawSid=u.searchParams.get('sid')||'';
 if(rawSid&&!/^[a-f0-9]{24,32}$/i.test(rawSid))return json(400,{error:'invalid_vod_session'});
 const sid=rawSid.toLowerCase();
 if(method==='POST'&&match[6]!=='stop'||method==='GET'&&match[6]==='stop')return json(405,{error:'method_not_allowed'});
 const secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^[a-f0-9]{64}$/i.test(secret))return json(503,{error:'vod_worker_not_configured'});
 const prefetch=match[6]==='index.m3u8'?Math.max(0,Math.min(duration-2,parseInt(u.searchParams.get('at')||'0',10)||0)):0;
 const params=new URLSearchParams();
 if(sid)params.set('sid',sid);
 if(match[6]==='index.m3u8')params.set('at',String(prefetch));
 const target='http://blofy-stream-web-media.railway.internal:8080/vodfull/'+match.slice(1).join('/')+'?'+params.toString();
 try{
  const response=await fetch(target,{method,headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret},redirect:'manual',signal:req.signal});
  if(response.status>=300&&response.status<400)return json(502,{error:'vod_worker_redirect_rejected'});
  if(!response.ok){let error='vod_unavailable';try{error=(await response.json()).error||error}catch{};return json(response.status,{error},verifiedWorkerRetryHeaders(response.headers))}
  return new Response(response.body,{status:200,headers:noCache({'Content-Type':match[6].endsWith('m3u8')?'application/vnd.apple.mpegurl':match[6]==='stop'?'application/json':'video/mp2t','Accept-Ranges':'none'})})
 }catch{return json(502,{error:'vod_worker_unreachable'})}
}
if(p.startsWith('/api/vod/')&&(method==='GET'||method==='POST')){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/vod\/(movie|series)\/([1-9][0-9]{0,14})\/(mkv|mp4|avi|mov|ts)\/([0-3])\/([0-9]{1,6})\/(index\.m3u8|seg-[0-9]{6}\.ts|meta|stop)$/);
 if(!match)return json(400,{error:'invalid_vod_path'});
 if(method==='POST'&&match[6]!=='stop')return json(405,{error:'invalid_method'});
 if(method==='GET'&&match[6]==='stop')return json(405,{error:'invalid_method'});
 const start=Number(match[5]);if(!Number.isSafeInteger(start)||start>172800)return json(400,{error:'invalid_vod_start'});
 const host='http://blofy-stream-web-media.railway.internal:8080';
 const secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^[a-f0-9]{64}$/i.test(secret))return json(503,{error:'vod_worker_not_configured'});
 const target=host+'/vod/'+match[1]+'/'+match[2]+'/'+match[3]+'/'+match[4]+'/'+match[5]+'/'+match[6];
 try{
  const response=await fetch(target,{method,headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret},redirect:'manual',signal:req.signal});
  if(response.status>=300&&response.status<400)return json(502,{error:'vod_worker_redirect_rejected'});
  if(!response.ok){let error='vod_unavailable';try{error=(await response.json()).error||error}catch{};return json(response.status,{error},verifiedWorkerRetryHeaders(response.headers))}
  return new Response(response.body,{status:200,headers:noCache({'Content-Type':match[6].endsWith('m3u8')?'application/vnd.apple.mpegurl':(match[6]==='stop'||match[6]==='meta')?'application/json':'video/mp2t','Accept-Ranges':'none'})})
 }catch{return json(502,{error:'vod_worker_unreachable'})}
}
if(p.startsWith('/api/hls/')&&method==='POST'){
 if(!h)return json(401,{error:'activation_required'});
 const m=p.match(/^\/api\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/(?:sid-([a-f0-9]{32})\/)?(?:(compat|ultra)\/)?stop$/);
 if(!m)return json(400,{error:'invalid_hls_stop'});
 const host=String(Bun.env.VIDAA_COMPAT_URL||''),secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^http:\/\/(?:blofy-vidaa-(?:media-compat-pilot|hls-dynamic)|blofy-stream-web-media)\.railway\.internal:8080$/.test(host)||!/^[a-f0-9]{64}$/.test(secret))return json(503,{error:'hls_worker_not_configured'});
 try{
  const r=await fetch(host+'/hls/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4]+'/'+(m[5]?'sid-'+m[5]+'/':'')+(m[6]?m[6]+'/':'')+'stop',{method:'POST',headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret},redirect:'manual',signal:AbortSignal.timeout(3000)});
  return json(r.ok?200:502,{ok:r.ok});
 }catch{return json(502,{error:'hls_stop_failed'})}
}
if(p.startsWith('/api/hls/')&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/(?:sid-([a-f0-9]{32})\/)?(?:(compat|ultra)\/)?(index\.m3u8|seg-[0-9]{6}\.ts)$/);
 if(!match)return json(400,{error:'invalid_hls_path'});
 const host=String(Bun.env.VIDAA_COMPAT_URL||''),secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^http:\/\/(?:blofy-vidaa-(?:media-compat-pilot|hls-dynamic)|blofy-stream-web-media)\.railway\.internal:8080$/.test(host)||!/^[a-f0-9]{64}$/.test(secret))return json(503,{error:'hls_worker_not_configured'});
 const target=host+'/hls/'+match[1]+'/'+match[2]+'/'+match[3]+'/'+match[4]+'/'+(match[5]?'sid-'+match[5]+'/':'')+(match[6]?match[6]+'/':'')+match[7];
 try{
  const response=await fetch(target,{method:'GET',headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret,'Accept':match[7]==='index.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t'},redirect:'manual',signal:req.signal});
  if(response.status>=300&&response.status<400)return json(502,{error:'hls_redirect_denied'});
  if(!response.ok){
   let error='hls_worker_failure';try{error=(await response.json())?.error||error}catch(e){}
   const retrySeconds=Number(response.headers.get('retry-after')||0);
   const headers=noCache({'Content-Type':'application/json'});
   // Forward only numeric 1–30 second wait hints, never upstream URLs,
   // subscription data, source headers or untrusted arbitrary retry values.
   if(Number.isInteger(retrySeconds)&&retrySeconds>=1&&retrySeconds<=30)
    headers['Retry-After']=String(retrySeconds);
   return new Response(JSON.stringify({error}),{status:response.status,headers})
  }
  var mode=response.headers.get('x-blofy-video-mode')||'unknown';
  if(!['source_copy','compatibility_transcode','ultra_transcode'].includes(mode))mode='unknown';
  var originResolution=response.headers.get('x-blofy-source-resolution')||'';
  if(!/^(?:[1-9][0-9]{1,3})x(?:[1-9][0-9]{1,3})$/.test(originResolution))originResolution='unknown';
  return new Response(response.body,{status:200,headers:noCache({
   'Content-Type':match[7]==='index.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t',
   'Accept-Ranges':'none','X-Blofy-Video-Mode':mode,
   'X-Blofy-Source-Resolution':originResolution
  })});
 }catch(e){return json(502,{error:'hls_worker_unreachable'})}
}
if(p==='/api/compatible/health'&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 try{
  const host=String(Bun.env.VIDAA_COMPAT_URL||'');
  if(!/^http:\/\/(?:blofy-vidaa-(?:media-compat-pilot|hls-dynamic)|blofy-stream-web-media)\.railway\.internal:8080$/.test(host))return json(503,{error:'compat_not_configured'});
  const r=await fetch(host+'/health',{redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(!r.ok)return json(503,{error:'compat_worker_unavailable'});
  const data=await r.json();return json(data.ok?200:503,{ok:!!data.ok,ffmpegAvailable:!!data.ffmpegAvailable,activeJobs:data.activeJobs,capacity:data.limit,
   liveQuality:['480','720','1080','2160'].includes(String(data.liveQuality))?String(data.liveQuality):'unknown',
   vodQuality:['480','720','1080','2160'].includes(String(data.vodQuality))?String(data.vodQuality):'unknown',
   sharedLive:{
    enabled:data.sharedLive?.enabled===true,
    groups:Math.max(0,Math.min(100,Number(data.sharedLive?.groups)||0)),
    viewers:Math.max(0,Math.min(400,Number(data.sharedLive?.viewers)||0)),
    pending:Math.max(0,Math.min(400,Number(data.sharedLive?.pending)||0)),
    maxPerGroup:Math.max(0,Math.min(10,Number(data.sharedLive?.maxPerGroup)||0))
   },
   originStability:{
    coolingSources:Math.max(0,Math.min(256,Number(data.originStability?.coolingSources)||0)),
    recentSources:Math.max(0,Math.min(256,Number(data.originStability?.recentSources)||0))
   }});
 }catch(e){return json(503,{error:'compat_worker_unreachable'})}
}
if(p.indexOf('/api/compatible/')===0&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/compatible\/(live|movie|series)\/([1-9][0-9]{0,14})\.(ts|mkv|mp4|avi|mov)$/);
 if(!match)return json(400,{error:'invalid_compat_media'});
 const host=String(Bun.env.VIDAA_COMPAT_URL||'');
 const secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^http:\/\/(?:blofy-vidaa-(?:media-compat-pilot|hls-dynamic)|blofy-stream-web-media)\.railway\.internal:8080$/.test(host)||!/^[a-f0-9]{64}$/.test(secret))return json(503,{error:'compat_unavailable'});
 const mode=u.searchParams.get('mode')==='video'?'video':'audio';
 const track=u.searchParams.get('track')||'0';
 if(!/^[0-3]$/.test(track))return json(400,{error:'invalid_audio_track'});
 const destination=host+'/convert/'+match[1]+'/'+match[2]+'.'+match[3]+'?mode='+mode+'&track='+track;
 try{
  const response=await fetch(destination,{method:'GET',headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret,'Accept':'*/*'},redirect:'manual',signal:req.signal});
  if(response.status>=300&&response.status<400)return json(502,{error:'compat_redirect_denied'});
  if(!response.ok){let data={};try{data=await response.json()}catch{};return json(response.status,{error:data.error||'compat_media_failed'})}
  const contentType=response.headers.get('content-type')||'application/octet-stream';
  return new Response(response.body,{status:200,headers:noCache({'Content-Type':contentType,'X-Blofy-Media-Mode':'compatible-'+mode,'Accept-Ranges':'none'})});
 }catch(e){return json(502,{error:'compat_proxy_unavailable'})}
}
if(p.indexOf('/api/media/')===0&&(method==='GET'||method==='HEAD')){
 const m=p.match(/^\/api\/media\/(live|movie|series)\/([0-9]{1,15})\.(ts|m3u8|mp4|mkv|avi|mov)$/i);if(!m)return json(400,{error:'invalid_media_path'});
 const target=ORIGIN+'/api/v1/stream/media/'+m[1]+'/'+m[2]+'.'+m[3].toLowerCase();
 const headers={'Authorization':h.Authorization,'Accept':'*/*','accept-encoding':'identity'};const range=req.headers.get('range');if(range&&/^bytes=[0-9]*-[0-9]*$/.test(range))headers['range']=range;
 try{
  const r=await fetch(target,{method,headers,redirect:'manual',signal:req.signal});
  if(r.status>=300&&r.status<400)return json(502,{error:'media_redirect_unsupported'});
  // Prevent an upstream server from silently ignoring a nonzero Range and
  // returning the beginning of a movie while the browser shows the seeked time.
  // Do NOT reject an ordinary bytes=0- request: some providers send 200 for it.
  const offset=range&&/^bytes=(\d+)-/.exec(range);
  if(offset&&Number(offset[1])>0&&r.ok){
   const contentRange=r.headers.get('content-range')||'';
   const firstByte=/^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(contentRange);
   if(r.status!==206||!firstByte||Number(firstByte[1])!==Number(offset[1])){
    try{await r.body?.cancel()}catch{}
    return json(416,{error:'media_byte_seek_not_supported'})
   }
  }
  let out=noCache({'Content-Type':r.headers.get('content-type')||'application/octet-stream'});
  for(const k of ['content-length','content-range','accept-ranges']){const v=r.headers.get(k);if(v)out[k]=v}
  return new Response(method==='HEAD'?null:r.body,{status:r.status,headers:out})
 }catch{return json(502,{error:'media_upstream_failed'})}
}
return json(404,{error:'not_found'});
}});
console.info('BLOFY STREAM Web 1.0 running on',server.port);
