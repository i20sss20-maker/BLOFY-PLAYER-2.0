import {normalizeDirectEntry} from './direct-provider-entry.mjs';
import {externalPlaylistOrigins} from './external-playlist-policy.mjs';
import {vodDownloadPath,downloadableResponse,attachmentFilename} from './vod-download-policy.mjs';
let activeVodDownloads=0;
const activeVodDownloadAccounts=new Map();
const activeVodDownloadTokens=new Map();
const MAX_VOD_DOWNLOADS=2;
import {validCommentaryId,safeCommentaryTracks,boundedCommentaryJson} from './commentary-catalog.mjs';
import {readCatalogPage} from './catalog-array-reader.mjs';
import { createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import {stableAccountProfileKey,legacyTokenProfileKey} from './web-profile-key.mjs';
import {createCatalogPageCache} from './catalog-page-cache.mjs';
import {createCatalogFlights} from './catalog-flights.mjs';
import {audioWorkerHost} from './audio-worker-policy.mjs';
import {createAdmission,readBoundedJson,sessionFailure,createPlaybackMetrics} from './web-security-controls.mjs';
const HTML=await Bun.file(new URL('./index.html',import.meta.url)).text()
const ORIGIN='https://blofyplayer.com';
const SYNTHETIC_PROJECT=Bun.env.RAILWAY_PROJECT_ID==='9501c37d-dd0c-44b5-90c6-5cb170d4e689';
const PLAYLIST_ORIGINS=Bun.env.BLOFY_WEB_EXTERNAL_PLAYLIST_QA==='1'?externalPlaylistOrigins(Bun.env.BLOFY_WEB_EXTERNAL_PLAYLIST_ORIGINS||''):[];
const KEY_HEX=String(Bun.env.VIDAA_SESSION_KEY||'');
const KEY=/^[a-f0-9]{64}$/i.test(KEY_HEX)?Buffer.from(KEY_HEX,'hex'):null;
const CT='application/json; charset=utf-8';
function json(status,body,extra={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':CT,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})}
function seal(token){if(!KEY)throw new Error('SESSION_KEY_MISSING');const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',KEY,iv);const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url')}
function unseal(s){try{if(!KEY||!s)return null;const v=Buffer.from(s,'base64url');if(v.length<30||v.length>500)return null;const c=createDecipheriv('aes-256-gcm',KEY,v.subarray(0,12));c.setAuthTag(v.subarray(12,28));return Buffer.concat([c.update(v.subarray(28)),c.final()]).toString('utf8')}catch{return null}}
function token(req){const m=String(req.headers.get('cookie')||'').match(/(?:^|;\s*)bv_session=([^;]+)/);return m?unseal(m[1]):null}
function auth(req){const t=token(req);return t?{'Authorization':'Bearer '+t,'Accept':'application/json','Cache-Control':'no-store'}:null}
function boundedEncoderCount(value,max=100000){
 const n=Number(value);
 return Number.isFinite(n)&&n>=0?Math.min(max,Math.trunc(n)):0
}
function safeEncoderCapacity(raw){
 // Anonymous numerical aggregate; never forward worker source paths, tokens,
 // customer info, hostnames, station identifiers or arbitrary JSON.
 const data=raw&&typeof raw==='object'?raw:{},jobs=data.jobKinds||{};
 return {busy:data.busy===true,
  freeSlots:boundedEncoderCount(data.freeSlots,2),
  deniedLastMinute:boundedEncoderCount(data.deniedLastMinute,100000),
  jobKinds:{
   live:boundedEncoderCount(jobs.live,2),
   legacyVod:boundedEncoderCount(jobs.legacyVod,2),
   fullVod:boundedEncoderCount(jobs.fullVod,2),
   compatible:boundedEncoderCount(jobs.compatible,2)
  }}
}
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
const catalogFlights=createCatalogFlights();
const allowed=new Set(['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams','get_series_categories','get_series','get_vod_info','get_series_info','get_short_epg','get_blofy_catalog_version']);
// External players cannot reuse browser cookies. Issue an opaque, one-use
// handoff scoped to one authorized live channel, never an Xtream credential.
const externalTickets=new Map(),externalActive=new Map();
const externalIssueGate=createAdmission({limit:8,maxKeys:2048,maxInflight:24});
const diagnosticGate=createAdmission({limit:60,maxKeys:4096,maxInflight:64,perKeyInflight:4});
const playbackMetrics=createPlaybackMetrics();
// Private, opt-in operator endpoint. Separate secret, never a customer token.
const OPS_KEY=String(Bun.env.VIDAA_WEB_OPS_KEY||'');
const opsEnabled=/^[a-f0-9]{64}$/i.test(OPS_KEY)&&OPS_KEY.toLowerCase()!==KEY_HEX.toLowerCase();
const opsWindows=[];
function opsAuthorized(req){
 if(!opsEnabled)return false;
 const supplied=req.headers.get('X-Blofy-Ops-Key')||'';
 return /^[a-f0-9]{64}$/i.test(supplied)&&timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(OPS_KEY,'hex'))
}
function opsSnapshot(){
 const cache=catalogPageCache.stats(),flights=catalogFlights.snapshot();
 return {mode:Bun.env.BLOFY_WEB_SYNTHETIC_ONLY==='1'?'synthetic-only':'service',
  uptimeSeconds:Math.floor(process.uptime()),
  rssBytes:process.memoryUsage().rss,
  catalog:{entries:cache.entries,inflight:flights.active,hits:cache.hits,misses:cache.misses,joined:flights.joined,rejected:flights.rejected},
  external:{pending:externalTickets.size,active:externalActive.size},
  control:{issuance:externalIssueGate.snapshot().inflight,diagnostics:diagnosticGate.snapshot().inflight},
  windows:opsWindows.slice()}
}
let previousCatalogCounters={hits:0,misses:0,joined:0,rejected:0,started:0};
setInterval(()=>{
 const report=playbackMetrics.drain(),cache=catalogPageCache.stats(),flights=catalogFlights.snapshot();
 const counters={hits:cache.hits,misses:cache.misses,joined:flights.joined,rejected:flights.rejected,started:flights.started};
 const delta=Object.fromEntries(Object.entries(counters).map(([k,v])=>[k,Math.max(0,v-previousCatalogCounters[k])]));
 previousCatalogCounters=counters;
 if(report.buckets.length||Object.values(delta).some(v=>v>0)||flights.active){
  const window={...report,catalog:{...delta,entries:cache.entries,inflight:flights.active},external:{pending:externalTickets.size,active:externalActive.size},control:{issuance:externalIssueGate.snapshot().inflight,diagnostics:diagnosticGate.snapshot().inflight}};
  if(opsEnabled){opsWindows.push(window);if(opsWindows.length>60)opsWindows.shift()}
  console.info('BLOFY_WEB_QOE_WINDOW',JSON.stringify(window))
 }
},60000).unref?.();
function downloadAccountKey(bearer){return typeof bearer==='string'&&bearer.startsWith('Bearer ')?stableAccountProfileKey(bearer.slice(7),KEY):null}
function externalAccountKey(bearer){return createHmac('sha256',KEY).update('external:'+bearer).digest('hex')}
function pruneExternalTickets(now=Date.now()){
 for(const [key,t] of externalTickets)if(t.until<=now)externalTickets.delete(key)
}
function revokeExternal(bearer){
 if(!bearer)return;
 const account=externalAccountKey(bearer);

 externalIssueGate.revoke(account);
 for(const [key,t] of externalTickets)if(t.account===account)externalTickets.delete(key);
 const active=externalActive.get(account);if(active)active.abort()
}
const server=Bun.serve({port:Number(Bun.env.PORT||3000),idleTimeout:255,async fetch(req){
const u=new URL(req.url);const p=u.pathname;const method=req.method;
if(p==='/internal/ops/view'||p==='/internal/ops/view.js'){
 if(method!=='GET'||!opsEnabled)return json(404,{error:'not_found'});
 const isJs=p.endsWith('.js'),file=Bun.file(new URL(isJs?'./ops-dashboard.js':'./ops-dashboard.html',import.meta.url));
 if(!await file.exists())return json(404,{error:'not_found'});
 return new Response(file,{headers:noCache({'Content-Type':isJs?'application/javascript; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",'X-Robots-Tag':'noindex, nofollow'})});
}
if(p==='/internal/ops'){
 if(method!=='GET'||!opsAuthorized(req))return json(404,{error:'not_found'});
 return json(200,opsSnapshot(),{'Referrer-Policy':'no-referrer'})
}

// Staging may exercise packaging and private worker readiness, but must not
// use production subscriptions, origins, catalog requests, or media sessions.
if(SYNTHETIC_PROJECT||Bun.env.BLOFY_WEB_SYNTHETIC_ONLY==='1'||Bun.env.RAILWAY_ENVIRONMENT_NAME==='staging'){
 if(p==='/health'&&method==='GET'){
  const host=audioWorkerHost('isolated');let audioReady=false;
  try{const r=await fetch(host+'/health',{redirect:'manual',signal:AbortSignal.timeout(3000)});const v=await r.json();audioReady=r.ok&&v.ok===true&&v.service==='blofy-stream-web-audio'}catch{}
  return json(KEY&&audioReady?200:503,{ok:Boolean(KEY&&audioReady),mode:'synthetic-only',audioReady});
 }
 if(p.startsWith('/api/')||p.startsWith('/external/'))return json(403,{error:'synthetic_staging_only'});
}


// Separate browser-only playlist surface. Never relax the subscriber app CSP
// or send third-party playlist credentials to the activation/media backend.
const playlistAssets={
 '/playlist-preview':'playlist-preview.html','/playlist-preview.js':'playlist-preview.js',
 '/playlist-preview.css':'playlist-preview.css','/approved-m3u-loader.mjs':'approved-m3u-loader.mjs',
 '/approved-m3u-catalog.mjs':'approved-m3u-catalog.mjs'
};
if(p==='/playlist-preview-policy'||Object.hasOwn(playlistAssets,p)){
 if(method!=='GET'||!PLAYLIST_ORIGINS.length||Bun.env.BLOFY_WEB_SYNTHETIC_ONLY==='1'||SYNTHETIC_PROJECT||Bun.env.RAILWAY_ENVIRONMENT_NAME==='staging')return json(404,{error:'not_found'});
 if(p==='/playlist-preview-policy')return json(200,{origins:PLAYLIST_ORIGINS},{'Referrer-Policy':'no-referrer'});
 const file=playlistAssets[p],asset=Bun.file(new URL('./'+file,import.meta.url));
 if(!await asset.exists())return json(404,{error:'not_found'});
 const mime=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
 const allowed=PLAYLIST_ORIGINS.join(' ');
 return new Response(asset,{headers:noCache({'Content-Type':mime,'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' "+allowed+"; media-src 'self' blob: "+allowed+"; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"})});
}
const isNativeArabicFont=p==='/fonts/IBMPlexSansArabic-Regular.ttf'||p==='/fonts/IBMPlexSansArabic-SemiBold.ttf';
if(method==='GET'&&(isNativeArabicFont||p==='/app.js'||p==='/profile-transfer.js'||p==='/playback-acceptance.js'||p==='/styles.css'||p==='/manifest.webmanifest'||p==='/stream-icon.svg'||p==='/apple-touch-icon.png'||p==='/icon-192.png'||p==='/icon-512.png'||p==='/sw.js')){
 const file=p.slice(1);
 const mime=isNativeArabicFont?'font/ttf':p==='/app.js'||p==='/profile-transfer.js'||p==='/playback-acceptance.js'||p==='/sw.js'?'application/javascript; charset=utf-8':p==='/styles.css'?'text/css; charset=utf-8':p==='/stream-icon.svg'?'image/svg+xml':(p==='/apple-touch-icon.png'||p==='/icon-192.png'||p==='/icon-512.png')?'image/png':'application/manifest+json; charset=utf-8';
 const asset=Bun.file(new URL('./'+file,import.meta.url));
 if(!await asset.exists())return json(404,{error:'static_asset_missing'});
 const headers=noCache({'Content-Type':mime,...(p==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})});
 if(isNativeArabicFont)headers['Cache-Control']='public,max-age=604800';
 return new Response(asset,{headers});
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
if(p==='/api/logout'&&method==='POST'){const t=token(req);if(t){const download=activeVodDownloadTokens.get(externalAccountKey('Bearer '+t));if(download)download.abort();}if(t)revokeExternal('Bearer '+t);return json(200,{ok:true},{'Set-Cookie':'bv_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
if(p==='/api/external/stop'&&method==='POST'){
 const h=auth(req);if(!h)return json(401,{error:'activation_required'});
 revokeExternal(h.Authorization);
 return json(200,{ok:true});
}
if(p==='/api/external/live'&&method==='POST'){
 const h=auth(req);if(!h)return json(401,{error:'activation_required'});
 const account=externalAccountKey(h.Authorization),lease=externalIssueGate.acquire(account);
 if(!lease.ok)return json(429,{error:'external_rate_limit'},{'Retry-After':String(lease.retryAfter)});
 try{
  const input=await readBoundedJson(req,256);if(!input.ok)return json(input.status,{error:'invalid_payload'});
  const id=String(input.value.id||'');if(!/^[1-9][0-9]{0,14}$/.test(id))return json(400,{error:'invalid_channel'});
  const checked=await fetch(ORIGIN+'/api/v1/stream/app/session',{headers:h,redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(!checked.ok){try{await checked.body?.cancel()}catch{};return json(checked.status===401?401:503,{error:'session_unavailable'})}
  const session=await checked.json();if(!session.active)return json(401,{error:'activation_required'});
  pruneExternalTickets();
  if(!lease.current()||req.signal.aborted)return json(401,{error:'session_cancelled'});
  if(externalActive.has(account))return json(409,{error:'external_stream_active'});
  for(const [key,t] of externalTickets)if(t.account===account)externalTickets.delete(key);
  if(externalTickets.size>=256)return json(429,{error:'external_capacity'});
  const now=Date.now(),accountExpiry=session.expiresAt?Date.parse(session.expiresAt):Infinity;
  if(!(accountExpiry>now))return json(401,{error:'subscription_expired'});
  const ticket=randomBytes(32).toString('base64url'),key=externalAccountKey(ticket);
  externalTickets.set(key,{id,account,bearer:h.Authorization,until:Math.min(now+120000,accountExpiry),accountExpiry});
  return json(200,{path:'/external/live/'+ticket+'.ts',expiresIn:120})
 }catch{return json(503,{error:'external_unavailable'})}finally{lease.release()}
}
if(p.startsWith('/external/live/')){
 if(method!=='GET'&&method!=='HEAD')return json(405,{error:'method_not_allowed'});
 const match=p.match(/^\/external\/live\/([A-Za-z0-9_-]{43})\.ts$/);
 if(!match)return json(404,{error:'external_invalid'});
 pruneExternalTickets();const key=externalAccountKey(match[1]),ticket=externalTickets.get(key);
 if(!ticket)return json(410,{error:'external_expired'});
 if(method==='HEAD')return new Response(null,{headers:noCache({'Content-Type':'video/mp2t','Accept-Ranges':'none'})});
 if(externalActive.has(ticket.account)||externalActive.size>=32)return json(429,{error:'external_capacity'});
 externalTickets.delete(key);
 const controller=new AbortController();externalActive.set(ticket.account,controller);
 const expiry=setTimeout(()=>controller.abort(),Math.min(2*60*60*1000,Math.max(0,ticket.accountExpiry-Date.now())));
 let headerTimer=setTimeout(()=>controller.abort(),15000),reader=null,closed=false;
 const cleanup=()=>{if(closed)return;closed=true;clearTimeout(expiry);clearTimeout(headerTimer);controller.abort();if(externalActive.get(ticket.account)===controller)externalActive.delete(ticket.account)};
 req.signal.addEventListener('abort',cleanup,{once:true});controller.signal.addEventListener('abort',cleanup,{once:true});
 try{
  if(req.signal.aborted){cleanup();return json(410,{error:'external_cancelled'})}
  const upstream=await fetch(ORIGIN+'/api/v1/stream/media/live/'+ticket.id+'.ts',{headers:{Authorization:ticket.bearer,Accept:'video/mp2t,application/octet-stream','accept-encoding':'identity'},redirect:'manual',signal:controller.signal});
  clearTimeout(headerTimer);
  const mime=(upstream.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(upstream.status!==200||!upstream.body||!['video/mp2t','application/octet-stream'].includes(mime)){try{await upstream.body?.cancel()}catch{};cleanup();return json([401,403,429].includes(upstream.status)?upstream.status:502,{error:'external_media_unavailable'})}
  reader=upstream.body.getReader();
  return new Response(new ReadableStream({
   async pull(c){try{const n=await reader.read();if(n.done){c.close();cleanup()}else c.enqueue(n.value)}catch(e){c.error(e);cleanup()}},
   cancel(){cleanup();try{return reader.cancel()}catch{}}
  }),{headers:noCache({'Content-Type':'video/mp2t','Accept-Ranges':'none'})});
 }catch{cleanup();return json(502,{error:'external_connection_failed'})}
}
// Fixed first-party credential exchange; never fetch the supplied M3U URL.
if(p==='/api/login-modes'&&method==='GET')return json(200,{direct:Bun.env.BLOFY_WEB_BOUND_LOGIN_QA==='1',external:PLAYLIST_ORIGINS.length>0});
if(p==='/api/direct-login'&&method==='POST'){
 if(Bun.env.BLOFY_WEB_BOUND_LOGIN_QA!=='1')return json(503,{ok:false,error:'direct_login_unavailable'});
 if(u.search||!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))return json(400,{ok:false,error:'invalid_payload'});
 const input=await readBoundedJson(req,4096);if(!input.ok)return json(input.status,{ok:false,error:'invalid_payload'});
 const key=input.value.deviceKey;
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return json(400,{ok:false,error:'invalid_payload'});
 let entry;try{entry=normalizeDirectEntry(input.value)}catch{return json(400,{ok:false,error:'invalid_provider_entry'})}
 try{
  const response=await fetch(ORIGIN+'/api/v1/stream/app/web-bound-login',{
   method:'POST',headers:{'Content-Type':CT,Accept:'application/json'},
   body:JSON.stringify({username:entry.username,password:entry.password,deviceKey:key}),
   redirect:'manual',signal:AbortSignal.timeout(15000)
  });
  if(!response.ok){try{await response.body?.cancel()}catch{};return json(response.status===429?429:response.status===401?401:503,{ok:false,error:'direct_login_unavailable'})}
  const v=await response.json();
  if(v?.ok!==true||typeof v.accessToken!=='string'||!/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(v.accessToken))return json(503,{ok:false,error:'direct_login_unavailable'});
  // Do not accept a token that cannot already access the existing account.
  const check=await fetch(ORIGIN+'/api/v1/stream/app/session',{headers:{Authorization:'Bearer '+v.accessToken,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!check.ok){try{await check.body?.cancel()}catch{};return json(503,{ok:false,error:'direct_login_unavailable'})}
  const session=await check.json();
  const profileKey=stableAccountProfileKey(v.accessToken,KEY),expiresAt=Number(session.expiresAt);
  if(!session.active||!profileKey||!Number.isFinite(expiresAt)||expiresAt<=Date.now())return json(401,{ok:false,error:'direct_login_unavailable'});
  return json(200,{ok:true,expiresAt,profileKey,legacyProfileKey:legacyTokenProfileKey(v.accessToken,KEY)},
   {'Set-Cookie':'bv_session='+seal(v.accessToken)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+Math.min(2592000,Math.floor((expiresAt-Date.now())/1000))});
 }catch{return json(503,{ok:false,error:'direct_login_unavailable'})}
}
if(p==='/api/redeem'&&method==='POST'){
 const inputResult=await readBoundedJson(req,2048);if(!inputResult.ok)return json(inputResult.status,{error:'invalid_payload'});
 const input=inputResult.value;
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
if(p==='/api/ai/translate'&&method==='POST'){
 const input=await readBoundedJson(req,18000);if(!input.ok)return json(input.status,{ok:false,error:'invalid_request'});
 const overview=typeof input.value?.overview==='string'?input.value.overview.trim():'';
 if(!overview||overview.length>3900)return json(400,{ok:false,error:'invalid_overview'});
 try{
  const response=await fetch('https://blofy-ai-gateway-production.up.railway.app/v1/translate',{
   method:'POST',redirect:'manual',headers:{'Content-Type':CT,'Authorization':h.Authorization,'Accept':'application/json','Cache-Control':'no-store'},
   body:JSON.stringify({title:'',overview,locale:'ar'}),signal:AbortSignal.timeout(24000)
  });
  if(!response.ok){try{await response.body?.cancel()}catch{};return json([401,403,429].includes(response.status)?response.status:503,{ok:false,error:'translation_unavailable'})}
  const data=await readBoundedJson(response,32000);
  const translated=data.ok&&data.value?.ok===true&&typeof data.value.translatedOverview==='string'?data.value.translatedOverview.trim():'';
  if(!translated||translated.length>5500||!/[\u0600-\u06ff]/.test(translated))return json(502,{ok:false,error:'invalid_translation'});
  return json(200,{ok:true,translatedOverview:translated})
 }catch{return json(503,{ok:false,error:'translation_unavailable'})}
}
if(p==='/api/ai/interpret'&&method==='POST'){
 // Same authenticated first-party gateway used by native STREAM Android.
 // Credentials remain server-side in the encrypted HttpOnly session cookie.
 if(!h)return json(401,{ok:false,error:'activation_required'});
 const aiInput=await readBoundedJson(req,2048);if(!aiInput.ok)return json(aiInput.status,{ok:false,error:'invalid_request'});
 const payload=aiInput.value;
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
   hls:info.hls?.ok===true,converting:Math.round(used),capacity:Math.round(limit),
   encoderCapacity:safeEncoderCapacity(info.encoderCapacity)});
 }catch{return json(503,{ok:false,player:'unreachable'})}
}
if(p==='/api/player-diagnostic'&&method==='POST'){
 const lease=diagnosticGate.acquire(externalAccountKey(h.Authorization));
 if(!lease.ok)return json(429,{error:'diagnostic_rate_limit'},{'Retry-After':String(lease.retryAfter)});
 try{
 const input=await readBoundedJson(req,700);if(!input.ok)return json(input.status,{error:'invalid_diagnostic'});const data=input.value;
 const kind=String(data?.kind||''),mode=String(data?.mode||''),phase=String(data?.phase||''),errorCode=Number(data?.errorCode)||0;
 if(!['live','movie','series'].includes(kind)||
  !['direct','audio','video','fullvod','vodhls','hls','mpegts'].includes(mode)||
  !['live_start','media_error','mpegts_error','startup_timeout','play_rejected','hls_error','vod_fallback','vod_full_start','vod_retry','vod_seek_request','vod_seek_ready','vod_seek_timeout','first_picture'].includes(phase)||
  !Number.isInteger(errorCode)||errorCode<0||errorCode>9)return json(400,{error:'invalid_diagnostic'});
 const rawId=String(data?.itemId||'');
 const itemRef=/^[1-9][0-9]{0,14}$/.test(rawId)&&KEY?
  createHmac('sha256',KEY).update(kind+':'+rawId).digest('hex').slice(0,12):null;
 const pos=Math.max(0,Math.min(21600,Math.round(Number(data?.position)||0)));
 const duration=Math.max(0,Math.min(21600,Math.round(Number(data?.duration)||0)));
 const runtime=['installed','browser','preview'].includes(data?.runtime)?data.runtime:'unknown';
 const firstPictureMs=phase==='first_picture'?Number(data.firstPictureMs):null;
 if(phase==='first_picture'&&(!Number.isInteger(firstPictureMs)||firstPictureMs<0||firstPictureMs>120000||!['decoded','presented'].includes(data.pictureBasis)))return json(400,{error:'invalid_picture_metric'});
 playbackMetrics.record({kind,runtime,phase,firstPictureMs});
 console.info('BLOFY_VIDAA_PLAYBACK_DIAG',{kind,mode,phase,runtime,errorCode,itemRef,position:pos,duration});
 return json(200,{ok:true});
 }finally{lease.release()}
}
if(p==='/api/session'&&method==='GET'){
 try{const r=await fetch(ORIGIN+'/api/v1/stream/app/session',{headers:h,redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok){const failure=sessionFailure(r.status);try{await r.body?.cancel()}catch{};return json(failure.status,failure.body)}const v=await r.json();return json(200,{ok:!!v.ok,active:!!v.active,daysRemaining:v.daysRemaining??null,expiresAt:v.expiresAt??null,
   profileKey:v.active?stableAccountProfileKey(token(req),KEY):null,
   legacyProfileKey:v.active?legacyTokenProfileKey(token(req),KEY):null})}catch{return json(503,{error:'session_unavailable'})}
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
 const flightKey=createHmac('sha256',KEY).update(JSON.stringify(['catalog-flight-v1',h.Authorization,k,cat,query,offset,limit])).digest('hex');
 const result=await catalogFlights.run(flightKey,async signal=>{
  const target=new URL(ORIGIN+'/player_api.php');target.searchParams.set('action',action);
  if(cat)target.searchParams.set('category_id',cat);
  let upstream=null,reader=null;
  try{
   upstream=await fetch(target,{headers:{...h,'accept-encoding':'identity'},redirect:'manual',signal});
   if(!upstream.ok||!upstream.body)return {status:upstream.status>=400?upstream.status:502,error:'catalog_unavailable'};
   reader=upstream.body.getReader();
   const page=await readCatalogPage(reader,{offset,limit,match:item=>
    (!cat||String(item.category_id||'')===cat)&&(!query||normalizeSearch(item.name||item.title||'').includes(query))});
   if(signal.aborted)return {status:499,error:'catalog_cancelled'};
   const payload={...page,kind:k};
   if(pageCacheKey)catalogPageCache.put(pageCacheKey,payload);
   return {status:200,payload};
  }catch{return {status:502,error:'catalog_page_failed'}}
  finally{try{void (reader?reader.cancel():upstream?.body?.cancel())?.catch(()=>{})}catch{}}
 },req.signal);
 if(result.status!==200)return json(result.status,{error:result.error},result.status===429?{'Retry-After':'2'}:{});
 return json(200,result.payload,{'X-Blofy-Catalog-Cache':'MISS'});
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
  return json(r.ok||r.status===404?200:502,{ok:r.ok||r.status===404});
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
   if(response.status===503&&error==='live_source_channel_limit')headers['X-Blofy-Live-Status']='source_channel_limit';
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
   encoderCapacity:safeEncoderCapacity(data.encoderCapacity),
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
if(p==='/api/commentary'&&method==='GET'){
 const h=auth(req);if(!h)return json(401,{error:'invalid_session'});
 const channel=u.searchParams.get('channel')||'';if(!/^[A-Za-z0-9_-]{1,80}$/.test(channel))return json(400,{error:'invalid_channel'});
 try{
  const r=await fetch(ORIGIN+'/api/v1/stream/audio/catalog',{headers:h,redirect:'manual',signal:AbortSignal.any([req.signal,AbortSignal.timeout(10000)])});
  if(!r.ok){await r.body?.cancel();return json(r.status===401||r.status===403?r.status:r.status===429?429:503,{error:'commentary_unavailable'})}
  return json(200,{tracks:safeCommentaryTracks(await boundedCommentaryJson(r),channel)});
 }catch{return json(503,{error:'commentary_unavailable'})}
}
if(p.startsWith('/api/commentary/')&&method==='GET'){
 const h=auth(req);if(!h)return json(401,{error:'invalid_session'});
 const id=p.slice('/api/commentary/'.length);if(!validCommentaryId(id))return json(404,{error:'unknown_track'});
 try{
  const r=await fetch(ORIGIN+'/api/v1/stream/media/audio/'+id,{headers:{Authorization:h.Authorization,Accept:'audio/*'},redirect:'manual',signal:req.signal});
  const rawMime=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  // Normalize only established audio aliases. Never label HTML/JSON or an
  // unknown binary body as audio and never relax the authenticated origin.
  const aliases:Record<string,string>={'audio/mp3':'audio/mpeg','audio/x-mpeg':'audio/mpeg','audio/x-mp3':'audio/mpeg','audio/x-aac':'audio/aac','audio/aacp':'audio/aac'};
  const mime=Object.hasOwn(aliases,rawMime)?aliases[rawMime]:rawMime;
  // The authenticated origin has already verified the input bytes. Convert
  // only known containers, without accepting generic binary/HTML/JSON.
  if(r.ok&&r.body&&['video/mp2t','audio/ogg','audio/flac'].includes(mime)){
   try{await r.body.cancel()}catch{}
   const mode=String(Bun.env.VIDAA_AUDIO_WORKER_MODE||''),host=audioWorkerHost(mode);
   const secret=String(mode==='isolated'?Bun.env.VIDAA_AUDIO_KEY||'':Bun.env.VIDAA_COMPAT_KEY||'');
   if(!host||!/^[a-f0-9]{64}$/i.test(secret))return json(503,{error:'audio_converter_unavailable'});
   // Default remains the deployed shared worker. Isolation is an explicit staging opt-in; no fallback opens a second source.
   const converted=await fetch(host+'/audio-compat/'+id,{headers:{Authorization:h.Authorization,'X-Compat-Secret':secret},redirect:'manual',signal:req.signal});
   if(!converted.ok||!converted.body||converted.headers.get('content-type')!=='audio/mpeg'){try{await converted.body?.cancel()}catch{};return json([401,403,429].includes(converted.status)?converted.status:503,{error:'audio_conversion_unavailable'})}
   return new Response(converted.body,{headers:noCache({'Content-Type':'audio/mpeg','Accept-Ranges':'none'})});
  }
  if(r.status!==200||!r.body||!['audio/mpeg','audio/aac','audio/mp4'].includes(mime)){
   console.warn('commentary_upstream_rejected',{status:r.status,hasBody:!!r.body,mimeClass:rawMime.startsWith('audio/')?'audio_other':rawMime==='application/octet-stream'?'binary':rawMime==='application/json'?'json':rawMime==='video/mp2t'?'transport_stream':'other'});
   await r.body?.cancel();return json(r.status===401||r.status===403?r.status:r.status===429?429:503,{error:'commentary_unavailable'})
  }
  return new Response(r.body,{headers:noCache({'Content-Type':mime,'Accept-Ranges':'none'})});
 }catch{return json(503,{error:'commentary_unavailable'})}
}
// File downloads are isolated from live and normal VOD playback.
// A browser writes the streamed bytes to its own download manager;
// it cannot be treated as a completed offline library item here.
if(p.startsWith('/api/download/')&&(method==='GET'||method==='HEAD')){
 if(!h)return json(401,{error:'activation_required'});
 if(Bun.env.BLOFY_WEB_VOD_DOWNLOAD_ENABLED!=='1')
  return json(503,{error:'downloads_not_enabled'});
 const match=/^\/api\/download\/(movie|series)\/([1-9][0-9]{0,14})\.(mp4|mkv|avi|mov|ts)$/.exec(p);
 if(!match||vodDownloadPath(match[1],match[2],match[3])!==p)
  return json(400,{error:'invalid_download_path'});
 const accountKey=downloadAccountKey(h.Authorization),ownerKey=externalAccountKey(h.Authorization);
 if(!accountKey)return json(401,{error:'invalid_session'});
 if(activeVodDownloads>=MAX_VOD_DOWNLOADS||activeVodDownloadAccounts.has(accountKey))
  return json(429,{error:'download_capacity_busy'},{'Retry-After':'15'});
 // Provider HEAD may fail or consume a licensed provider slot. Probe only
 // the authenticated, local feature gate; do not claim this proves that
 // the remote movie file is available or complete.
 if(method==='HEAD')return new Response(null,{status:200,headers:noCache({'Accept-Ranges':'none'})});
 const target=ORIGIN+'/api/v1/stream/media/'+match[1]+'/'+match[2]+'.'+match[3];
 const ctrl=new AbortController();
 let released=false,reader=null,headerTimer=null,deadline=null;
 const release=()=>{if(released)return;released=true;clearTimeout(deadline);clearTimeout(headerTimer);activeVodDownloads=Math.max(0,activeVodDownloads-1);if(activeVodDownloadAccounts.get(accountKey)===ctrl)activeVodDownloadAccounts.delete(accountKey);if(activeVodDownloadTokens.get(ownerKey)===ctrl)activeVodDownloadTokens.delete(ownerKey);req.signal.removeEventListener('abort',cancel);ctrl.signal.removeEventListener('abort',cancelReader)};
 const cancelReader=()=>{try{if(reader)Promise.resolve(reader.cancel()).catch(()=>{})}catch{}release()};
 const cancel=()=>ctrl.abort();
 activeVodDownloads++;activeVodDownloadAccounts.set(accountKey,ctrl);activeVodDownloadTokens.set(ownerKey,ctrl);
 ctrl.signal.addEventListener('abort',cancelReader,{once:true});
 req.signal.addEventListener('abort',cancel,{once:true});
 headerTimer=setTimeout(cancel,20000);deadline=setTimeout(cancel,30*60*1000);
 if(req.signal.aborted){cancel();return json(499,{error:'download_cancelled'})}
 try{
  const upstream=await fetch(target,{
   method,headers:{Authorization:h.Authorization,Accept:'application/octet-stream,video/*;q=0.9','accept-encoding':'identity'},
   redirect:'manual',signal:ctrl.signal
  });
  clearTimeout(headerTimer);
  if(ctrl.signal.aborted){try{await upstream.body?.cancel()}catch{}release();return json(499,{error:'download_cancelled'})}
  if(!downloadableResponse(upstream.status,upstream.headers.get('content-type'))||!upstream.body||upstream.headers.has('content-range')){
   try{await upstream.body?.cancel()}catch{}
   release();
   return json(upstream.status===401||upstream.status===403?403:upstream.status===404?404:502,
     {error:'download_source_unavailable'});
  }
  const out=noCache({'Content-Type':'application/octet-stream',
    'Content-Disposition':'attachment; filename="'+attachmentFilename(match[1],match[2],match[3])+'"',
    'X-Content-Type-Options':'nosniff','Accept-Ranges':'none'});
  const length=upstream.headers.get('content-length'),encoding=upstream.headers.get('content-encoding');
  // A completed transfer must contain the exact advertised number of bytes.
  // Unknown-size or compressed responses cannot prove a complete raw file.
  if(!length||!/^[1-9][0-9]{0,14}$/.test(length)||(encoding&&encoding.toLowerCase()!=='identity')){
   try{await upstream.body.cancel()}catch{}release();return json(502,{error:'download_size_unverified'});
  }
  out['Content-Length']=length;
  reader=upstream.body.getReader();
  const expected=out['Content-Length']?Number(out['Content-Length']):null;
  let received=0;
  // Pull one chunk at a time (no entire movie buffered in Railway RAM).
  const stream=new ReadableStream({
   async pull(controller){
    try{
     const chunk=await reader.read();
     if(ctrl.signal.aborted){release();controller.error(new Error('download_cancelled'));return}
     if(chunk.done){release();if(expected!==null&&received!==expected){controller.error(new Error('download_size_mismatch'));return}controller.close();return}
     received+=chunk.value.byteLength;if(expected!==null&&received>expected){cancel();controller.error(new Error('download_size_mismatch'));return}
     controller.enqueue(chunk.value);
    }catch{release();controller.error(new Error('download_stream_interrupted'))}
   },
   async cancel(){cancel();release()}
  });
  return new Response(stream,{status:200,headers:out});
 }catch{release();return json(502,{error:'download_source_unreachable'})}
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
