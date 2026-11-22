import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
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
function noCache(extra={}){return {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}}
const allowed=new Set(['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams','get_series_categories','get_series','get_vod_info','get_series_info','get_short_epg','get_blofy_catalog_version']);
const server=Bun.serve({port:Number(Bun.env.PORT||3000),idleTimeout:255,async fetch(req){
const u=new URL(req.url);const p=u.pathname;const method=req.method;

if(method==='GET'&&(p==='/app.js'||p==='/styles.css'||p==='/manifest.webmanifest'||p==='/stream-icon.svg')){
 const file=p.slice(1);
 const mime=p==='/app.js'?'application/javascript; charset=utf-8':p==='/styles.css'?'text/css; charset=utf-8':p==='/stream-icon.svg'?'image/svg+xml':'application/manifest+json; charset=utf-8';
 const asset=Bun.file(new URL('./'+file,import.meta.url));
 if(!await asset.exists())return json(404,{error:'static_asset_missing'});
 return new Response(asset,{headers:noCache({'Content-Type':mime})});
}
if(p==='/'&&method==='GET')return new Response(HTML,{status:200,headers:noCache({'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"})});


if(p==='/app.webmanifest'&&method==='GET'){
 return new Response(JSON.stringify({id:'/',name:'BLOFY STREAM',short_name:'BLOFY',description:'BLOFY STREAM Web & VIDAA experimental edition',start_url:'/',scope:'/',display:'standalone',orientation:'landscape',background_color:'#09090c',theme_color:'#0b0b10',lang:'ar',dir:'rtl',icons:[{src:'/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]}),{headers:{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'public,max-age=3600'}})
}
if(p==='/app-icon.svg'&&method==='GET')return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"512\" height=\"512\" viewBox=\"0 0 512 512\"><defs><linearGradient id=\"g\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\"><stop stop-color=\"#49303a\"/><stop offset=\"1\" stop-color=\"#080a0f\"/></linearGradient></defs><rect width=\"512\" height=\"512\" rx=\"96\" fill=\"url(#g)\"/><rect x=\"40\" y=\"40\" width=\"432\" height=\"432\" rx=\"72\" fill=\"none\" stroke=\"#d6ad79\" stroke-width=\"8\"/><text x=\"256\" y=\"270\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"121\" font-weight=\"bold\" letter-spacing=\"5\" fill=\"#efc587\">BLOFY</text><text x=\"256\" y=\"331\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"44\" letter-spacing=\"18\" fill=\"#e8c18d\">STREAM</text></svg>",{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'}});

if(p==='/health'&&method==='GET')return json(200,{ok:true,app:'blofy-stream-web-native-parity',ready:Boolean(KEY),version:'0.1.0-native-parity'});

if(p==='/vendor/mpegts.js'&&method==='GET'){
 for(const src of ['https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.js','https://unpkg.com/mpegts.js@1.7.3/dist/mpegts.js']){
  try{const r=await fetch(src,{redirect:'error',signal:AbortSignal.timeout(12000)});
   if(r.ok&&r.body)return new Response(r.body,{status:200,headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=21600','X-Content-Type-Options':'nosniff'}});
  }catch(e){}
 }
 return json(503,{error:'video_engine_unavailable'});
}
if(!KEY)return json(503,{ok:false,error:'preview_not_configured'});
if(p==='/api/logout'&&method==='POST')return json(200,{ok:true},{'Set-Cookie':'bv_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
if(p==='/api/redeem'&&method==='POST'){
 let input={};try{if(Number(req.headers.get('content-length')||0)>2048)return json(413,{error:'invalid_payload'});input=await req.json()}catch{return json(400,{error:'invalid_payload'})}
 const code=String(input.code||'').toUpperCase().trim();const key=String(input.deviceKey||'');
 if(!/^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(code)||!/^[a-f0-9]{64}$/.test(key))return json(400,{error:'كود أو جهاز غير صالح'});
 try{const r=await fetch(ORIGIN+'/api/v1/stream/app/redeem',{method:'POST',headers:{'Content-Type':CT,'Accept':'application/json'},body:JSON.stringify({code,deviceKey:key}),redirect:'manual',signal:AbortSignal.timeout(20000)});
 let v={};try{v=await r.json()}catch{}if(!r.ok||!v.ok||typeof v.accessToken!=='string'||!/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(v.accessToken))return json(r.status===409?409:r.status===429?429:400,{ok:false,error:r.status===409?'الكود مستخدم أو مربوط بجهاز آخر':r.status===429?'محاولات كثيرة، حاول لاحقًا':'تعذّر تفعيل الكود'});
 return json(200,{ok:true,activatedAt:v.account?.activatedAt||null,expiresAt:v.account?.expiresAt||null},{'Set-Cookie':'bv_session='+seal(v.accessToken)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000'});
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
if(p==='/api/player-diagnostic'&&method==='POST'){
 let data;try{if(Number(req.headers.get('content-length')||0)>700)return json(413,{error:'too_large'});data=await req.json()}catch{return json(400,{error:'invalid_diagnostic'})}
 const kind=String(data?.kind||''),mode=String(data?.mode||''),phase=String(data?.phase||''),errorCode=Number(data?.errorCode)||0;
 if(!['live','movie','series'].includes(kind)||!['direct','audio','video'].includes(mode)||!['media_error','mpegts_error','startup_timeout','play_rejected','hls_error'].includes(phase)||errorCode<0||errorCode>9)return json(400,{error:'invalid_diagnostic'});
 console.info('BLOFY_VIDAA_PLAYBACK_DIAG',{kind,mode,phase,errorCode});
 return json(200,{ok:true});
}
if(p==='/api/session'&&method==='GET'){
 try{const r=await fetch(ORIGIN+'/api/v1/stream/app/session',{headers:h,redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok)return json(r.status===403?403:401,{active:false});const v=await r.json();return json(200,{ok:!!v.ok,active:!!v.active,daysRemaining:v.daysRemaining??null,expiresAt:v.expiresAt??null})}catch{return json(502,{active:false,error:'session_unavailable'})}
}

if(p==='/api/page'&&method==='GET'){
 const k=u.searchParams.get('kind'),action=k==='live'?'get_live_streams':k==='movie'?'get_vod_streams':k==='series'?'get_series':null;
 if(!action)return json(400,{error:'invalid_kind'});
 const cat=u.searchParams.get('category_id')||'',query=(u.searchParams.get('query')||'').trim().toLowerCase().slice(0,75);
 if(cat&&!/^[0-9]{1,18}$/.test(cat))return json(400,{error:'invalid_category'});
 const offset=Math.max(0,Math.min(10000,parseInt(u.searchParams.get('offset')||'0',10)||0));
 const limit=Math.max(1,Math.min(48,parseInt(u.searchParams.get('limit')||'30',10)||30));
 const target=new URL(ORIGIN+'/player_api.php');target.searchParams.set('action',action);
 if(cat)target.searchParams.set('category_id',cat);
 let upstream=null,reader=null;
 try{
  upstream=await fetch(target,{headers:{...h,'accept-encoding':'identity'},redirect:'manual',signal:AbortSignal.timeout(100000)});
  if(!upstream.ok||!upstream.body)return json(upstream.status>=400?upstream.status:502,{error:'catalog_unavailable'});
  reader=upstream.body.getReader();
  const decoder=new TextDecoder(),matches=[];
  let textBuffer='',depth=0,inString=false,escapeNext=false,capturing=false,matched=0,hasMore=false,done=false,bytes=0;
  while(!done){
   const packet=await reader.read();
   if(packet.done)break;
   bytes+=packet.value.byteLength;if(bytes>100*1024*1024)break;
   const piece=decoder.decode(packet.value,{stream:true});
   for(let i=0;i<piece.length;i++){
    const ch=piece[i];
    if(!capturing){
     if(ch==='{'){capturing=true;depth=1;inString=false;escapeNext=false;textBuffer='{'}
     else if(ch===']')done=true;
     continue;
    }
    textBuffer+=ch;
    if(textBuffer.length>200000)throw new Error('catalog_item_too_large');
    if(escapeNext){escapeNext=false;continue}
    if(ch==='\\'&&inString){escapeNext=true;continue}
    if(ch==='"'){inString=!inString;continue}
    if(!inString){if(ch==='{')depth++;else if(ch==='}')depth--}
    if(depth!==0)continue;
    capturing=false;
    try{
     const item=JSON.parse(textBuffer);
     if((!cat||String(item.category_id||'')===cat)&&(!query||String(item.name||item.title||'').toLowerCase().includes(query))){
      if(matched>=offset){
       if(matches.length>=limit){hasMore=true;done=true;break}
       matches.push(item);
      }
      matched++;
     }
    }catch(e){}
    textBuffer='';
   }
  }
  try{await reader.cancel()}catch(e){}
  return json(200,{items:matches,hasMore,nextOffset:offset+matches.length,kind:k});
 }catch(e){try{await reader?.cancel()}catch{};return json(502,{error:'catalog_page_failed'})}
}

if(p==='/api/catalog'&&method==='GET'){
 const action=u.searchParams.get('action')||'';if(!allowed.has(action))return json(400,{error:'invalid_action'});
 const url=new URL(ORIGIN+'/player_api.php');url.searchParams.set('action',action);
 for(const x of ['category_id','series_id','vod_id','stream_id','limit']){const v=u.searchParams.get(x);if(v&&/^[0-9]{1,15}$/.test(v))url.searchParams.set(x,v)}
 try{const r=await fetch(url,{method:'GET',headers:{...h,'accept-encoding':'identity'},redirect:'manual',signal:AbortSignal.timeout(120000)});if(r.status>=300&&r.status<400)return json(502,{error:'unexpected_redirect'});return new Response(r.body,{status:r.status,headers:noCache({'Content-Type':'application/json; charset=utf-8'})})}catch{return json(502,{error:'catalog_upstream_failed'})}
}



if(p.startsWith('/api/vod/')&&(method==='GET'||method==='POST')){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/vod\/(movie|series)\/([1-9][0-9]{0,14})\/(mkv|mp4|avi|mov|ts)\/([0-3])\/([0-9]{1,6})\/(index\.m3u8|seg-[0-9]{6}\.ts|stop)$/);
 if(!match)return json(400,{error:'invalid_vod_path'});
 if(method==='POST'&&match[6]!=='stop')return json(405,{error:'invalid_method'});
 if(method==='GET'&&match[6]==='stop')return json(405,{error:'invalid_method'});
 const start=Number(match[5]);if(!Number.isSafeInteger(start)||start>172800)return json(400,{error:'invalid_vod_start'});
 const host='http://blofy-stream-web-vod-seek-pilot.railway.internal:8080';
 const secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^[a-f0-9]{64}$/i.test(secret))return json(503,{error:'vod_worker_not_configured'});
 const target=host+'/vod/'+match[1]+'/'+match[2]+'/'+match[3]+'/'+match[4]+'/'+match[5]+'/'+match[6];
 try{
  const response=await fetch(target,{method,headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret},redirect:'manual',signal:req.signal});
  if(response.status>=300&&response.status<400)return json(502,{error:'vod_worker_redirect_rejected'});
  if(!response.ok){let error='vod_unavailable';try{error=(await response.json()).error||error}catch{};return json(response.status,{error})}
  return new Response(response.body,{status:200,headers:noCache({'Content-Type':match[6].endsWith('m3u8')?'application/vnd.apple.mpegurl':match[6]==='stop'?'application/json':'video/mp2t','Accept-Ranges':'none'})})
 }catch{return json(502,{error:'vod_worker_unreachable'})}
}
if(p.startsWith('/api/hls/')&&method==='POST'){
 if(!h)return json(401,{error:'activation_required'});
 const m=p.match(/^\/api\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/stop$/);
 if(!m)return json(400,{error:'invalid_hls_stop'});
 const host=String(Bun.env.VIDAA_COMPAT_URL||''),secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^http:\/\/blofy-vidaa-(?:media-compat-pilot|hls-dynamic)\.railway\.internal:8080$/.test(host)||!/^[a-f0-9]{64}$/.test(secret))return json(503,{error:'hls_worker_not_configured'});
 try{
  const r=await fetch(host+'/hls/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4]+'/stop',{method:'POST',headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret},redirect:'manual',signal:AbortSignal.timeout(3000)});
  return json(r.ok?200:502,{ok:r.ok});
 }catch{return json(502,{error:'hls_stop_failed'})}
}
if(p.startsWith('/api/hls/')&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/(index\.m3u8|seg-[0-9]{6}\.ts)$/);
 if(!match)return json(400,{error:'invalid_hls_path'});
 const host=String(Bun.env.VIDAA_COMPAT_URL||''),secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^http:\/\/blofy-vidaa-(?:media-compat-pilot|hls-dynamic)\.railway\.internal:8080$/.test(host)||!/^[a-f0-9]{64}$/.test(secret))return json(503,{error:'hls_worker_not_configured'});
 const target=host+'/hls/'+match[1]+'/'+match[2]+'/'+match[3]+'/'+match[4]+'/'+match[5];
 try{
  const response=await fetch(target,{method:'GET',headers:{'Authorization':h.Authorization,'X-Compat-Secret':secret,'Accept':match[5]==='index.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t'},redirect:'manual',signal:req.signal});
  if(response.status>=300&&response.status<400)return json(502,{error:'hls_redirect_denied'});
  if(!response.ok){let error='hls_worker_failure';try{error=(await response.json())?.error||error}catch(e){};return json(response.status,{error})}
  return new Response(response.body,{status:200,headers:noCache({'Content-Type':match[5]==='index.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t','Accept-Ranges':'none'})});
 }catch(e){return json(502,{error:'hls_worker_unreachable'})}
}
if(p==='/api/compatible/health'&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 try{
  const host=String(Bun.env.VIDAA_COMPAT_URL||'');
  if(!/^http:\/\/blofy-vidaa-(?:media-compat-pilot|hls-dynamic)\.railway\.internal:8080$/.test(host))return json(503,{error:'compat_not_configured'});
  const r=await fetch(host+'/health',{redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(!r.ok)return json(503,{error:'compat_worker_unavailable'});
  const data=await r.json();return json(data.ok?200:503,{ok:!!data.ok,ffmpegAvailable:!!data.ffmpegAvailable,activeJobs:data.activeJobs,capacity:data.limit});
 }catch(e){return json(503,{error:'compat_worker_unreachable'})}
}
if(p.indexOf('/api/compatible/')===0&&method==='GET'){
 if(!h)return json(401,{error:'activation_required'});
 const match=p.match(/^\/api\/compatible\/(live|movie|series)\/([1-9][0-9]{0,14})\.(ts|mkv|mp4|avi|mov)$/);
 if(!match)return json(400,{error:'invalid_compat_media'});
 const host=String(Bun.env.VIDAA_COMPAT_URL||'');
 const secret=String(Bun.env.VIDAA_COMPAT_KEY||'');
 if(!/^http:\/\/blofy-vidaa-(?:media-compat-pilot|hls-dynamic)\.railway\.internal:8080$/.test(host)||!/^[a-f0-9]{64}$/.test(secret))return json(503,{error:'compat_unavailable'});
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
 try{const r=await fetch(target,{method,headers,redirect:'manual',signal:req.signal});if(r.status>=300&&r.status<400)return json(502,{error:'media_redirect_unsupported'});let out=noCache({'Content-Type':r.headers.get('content-type')||'application/octet-stream'});for(const k of ['content-length','content-range','accept-ranges']){let v=r.headers.get(k);if(v)out[k]=v}return new Response(method==='HEAD'?null:r.body,{status:r.status,headers:out})}catch{return json(502,{error:'media_upstream_failed'})}
}
return json(404,{error:'not_found'});
}});
console.info('BLOFY STREAM native-parity web preview running on',server.port);
