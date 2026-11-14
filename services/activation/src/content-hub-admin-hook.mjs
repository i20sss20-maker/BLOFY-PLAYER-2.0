// BLOFY admin-only private Content Hub bridge. No provider credentials here.
// The admin-session hook runs first and replaces valid session authentication
// with the existing BLOFY_ADMIN_TOKEN. Client traffic never sees Hub tokens.
import http from 'node:http';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';
import {adminCanaryRange,HUB_PILOT_RUN} from './content-hub-admin-core.mjs';

const HUB='http://blofy-content-hub.railway.internal:3000';
const ADMIN=String(process.env.BLOFY_ADMIN_TOKEN||'').trim();
const HUB_TOKEN=String(process.env.BLOFY_CONTENT_HUB_OPERATOR_TOKEN||'').trim();
const limiter=createFixedWindowLimiter({limit:180,windowMs:60000});
const runRoute=/^\/api\/v1\/admin\/content-hub\/canary\/([A-Za-z0-9_-]{8,80})$/;
const mimeAllowed=new Set(['video/mp4','video/x-matroska','video/mp2t','video/x-msvideo']);
const json=(res,status,body)=>{
 const data=Buffer.from(JSON.stringify(body));
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'content-length':data.length,'cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(data);
};
function equal(a,b){
 const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function authorized(req,res){
 if(!ADMIN||!equal(req.headers.authorization,'Bearer '+ADMIN)){
  json(res,401,{ok:false,code:'admin_required'});return false;
 }
 if(!limiter.consume(requestClientKey(req)).allowed){
  json(res,429,{ok:false,code:'admin_rate_limited'});return false;
 }
 if(HUB_TOKEN.length<32){
  json(res,503,{ok:false,code:'private_hub_bridge_not_configured'});return false;
 }
 return true;
}
function request(path,{method='GET',range,signal,confirmBatch=false,extraHeaders={},body}={}){
 const headers={authorization:'Bearer '+HUB_TOKEN};
 if(range)headers.range=range;
 if(confirmBatch)headers['x-blofy-batch-confirm']='approved-8mib-batch';
 Object.assign(headers,extraHeaders);
 return fetch(HUB+path,{method,headers,body,redirect:'manual',
  signal:signal||AbortSignal.timeout(8000)});
}
async function readSeasonAdminBody(req){
 if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
  throw Error('season_admin_json_required');
 let size=0;const chunks=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>8192)throw Error('season_admin_payload_too_large');
  chunks.push(chunk);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 catch{throw Error('season_admin_json_invalid')}
}
async function safeReadJson(response){
 if(response.status!==200||!String(response.headers.get('content-type')||'')
   .includes('application/json'))throw Error('hub_private_response_unavailable');
 return response.json();
}
async function handleStatus(res){
 const [a,b]=await Promise.all([
  request('/internal/status',{signal:AbortSignal.timeout(8000)}),
  request('/internal/pilots',{signal:AbortSignal.timeout(8000)})
 ]);
 const [state,history]=await Promise.all([safeReadJson(a),safeReadJson(b)]);
 json(res,200,{ok:true,service:state.ok?'online':'degraded',
  privateBucketAvailable:state.privateBucketAvailable===true,
  databaseAvailable:state.databaseAvailable===true,
  pilotRunning:state.pilotRunning===true,
  customerCutover:false,downloadQueueEnabled:false,
  chunkedBatchEnabled:history.chunkedBatchEnabled===true,
  latest:state.durablePilot||state.lastPilot||null,
  accounting:history.accounting||null,
  runs:Array.isArray(history.runs)?history.runs:[]});
}
async function handleCanary(req,res,id){
 if(!HUB_PILOT_RUN.test(id))return json(res,404,{ok:false});
 const ctrl=new AbortController();
 const onClosed=()=>ctrl.abort();
 res.once('close',onClosed);
 const timer=setTimeout(()=>ctrl.abort(),90000);
 timer.unref?.();
 let body=null;
 try{
  const meta=await request('/internal/pilot/playback/'+id,{
   method:'HEAD',signal:ctrl.signal});
  if(meta.status!==200)
   return json(res,404,{ok:false,code:'verified_movie_not_available'});
  const bytes=Number(meta.headers.get('content-length'));
  const type=String(meta.headers.get('content-type')||'');
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>4*1024**3||
    !mimeAllowed.has(type))
   throw Error('invalid_private_movie_metadata');
  const ctype=type;
  if(req.method==='HEAD'){
   res.writeHead(200,{'content-length':String(bytes),
    'content-type':ctype,'accept-ranges':'bytes',
    'cache-control':'private,no-store','x-content-type-options':'nosniff'});
   return res.end();
  }
  const range=adminCanaryRange(req.headers.range,bytes);
  if(!range)return json(res,416,{ok:false,code:'invalid_media_range'});
  const header='bytes='+range.from+'-'+range.to;
  const response=await request('/internal/pilot/playback/'+id,{
   range:header,signal:ctrl.signal});
  const size=range.to-range.from+1;
  if(response.status!==206||!response.body||
     response.headers.get('content-range')!==
       `bytes ${range.from}-${range.to}/${bytes}`||
     Number(response.headers.get('content-length'))!==size)
   throw Error('private_movie_range_invalid');
  body=response.body;
  res.writeHead(206,{
   'content-type':ctype,'content-length':String(size),
   'content-range':`bytes ${range.from}-${range.to}/${bytes}`,
   'accept-ranges':'bytes','cache-control':'private,no-store',
   'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
  });
  let sent=0;
  for await(const chunk of body){
   if(ctrl.signal.aborted)throw Error('client_closed');
   sent+=chunk.byteLength;
   if(sent>size)throw Error('private_movie_overrun');
   if(!res.write(chunk)){
    await new Promise((resolve,reject)=>{
     const done=()=>{clean();resolve()};
     const error=()=>{clean();reject(Error('client_closed'))};
     const clean=()=>{
      res.off('drain',done);res.off('close',error);
     };
     res.once('drain',done);res.once('close',error);
    });
   }
  }
  if(sent!==size)throw Error('private_movie_short');
  res.end();
 }catch{
  if(res.headersSent){if(!res.destroyed)res.destroy()}
  else if(!res.destroyed)json(res,503,{
   ok:false,code:'private_movie_canary_unavailable'});
 }finally{
  clearTimeout(timer);
  res.off('close',onClosed);
  try{await body?.cancel?.()}catch{}
 }
}
async function handleEpisodePreview(req,res){
 const ctrl=new AbortController();
 const close=()=>ctrl.abort();
 res.once('close',close);
 const timer=setTimeout(()=>ctrl.abort(),85000);timer.unref?.();
 try{
  const response=await request('/internal/episodes/playback/preview',{
   signal:ctrl.signal,extraHeaders:{
    'x-blofy-owner-preview':'operator-episode-only'}});
  if(response.status!==200||!response.body||
     response.headers.get('content-type')!=='video/mp4')
   return json(res,503,{ok:false,code:'episode_preview_not_available'});
  const length=Number(response.headers.get('content-length'));
  if(!Number.isSafeInteger(length)||length<1||length>32*1024*1024)
   return json(res,503,{ok:false,code:'episode_preview_invalid_size'});
  res.writeHead(200,{
   'content-type':'video/mp4','content-length':String(length),
   'content-disposition':'inline; filename="blofy-episode-preview.mp4"',
   'cache-control':'private,no-store',
   'cross-origin-resource-policy':'same-origin',
   'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  let sent=0;
  for await(const chunk of response.body){
   if(ctrl.signal.aborted)throw Error('preview_closed');
   sent+=chunk.byteLength;
   if(sent>length)throw Error('preview_overlong');
   if(!res.write(chunk))await new Promise((resolve,reject)=>{
    const clean=()=>{res.off('drain',onDrain);res.off('close',onClose)};
    const onDrain=()=>{clean();resolve()};
    const onClose=()=>{clean();reject(Error('preview_closed'))};
    res.once('drain',onDrain);res.once('close',onClose);
   });
  }
  if(sent!==length)throw Error('preview_short');
  return res.end();
 }catch{
  if(res.headersSent){if(!res.destroyed)res.destroy()}
  else if(!res.destroyed)json(res,503,{
   ok:false,code:'episode_preview_temporarily_unavailable'});
 }finally{clearTimeout(timer);res.off('close',close)}
}
const old=http.createServer.bind(http);
http.createServer=function withContentHubAdmin(listener){
 if(typeof listener!=='function')return old(listener);
 return old(async(req,res)=>{
  let url;
  try{url=new URL(req.url||'/','http://localhost')}
  catch{return listener(req,res)}
  const path=url.pathname;
  if(req.method==='GET'&&['/admin-content-hub.css',
    '/admin-content-hub.js','/admin-season-analytics.js'].includes(path)){
   try{
    const file=path.slice(1);
    const data=await readFile(new URL('../web/'+file,import.meta.url));
    res.writeHead(200,{
      'content-type':file.endsWith('.css')?'text/css':'text/javascript',
      'content-length':data.length,'cache-control':'no-store',
      'x-content-type-options':'nosniff'
    });
    return res.end(data);
   }catch{return json(res,503,{ok:false,code:'admin_asset_unavailable'})}
  }
  const canary=runRoute.exec(path);
  if(!path.startsWith('/api/v1/admin/content-hub/'))return listener(req,res);
  if(!authorized(req,res))return;
  if(url.search)return json(res,400,{ok:false,code:'query_forbidden'});
  try{
   if(path==='/api/v1/admin/content-hub/episodes/preview'&&req.method==='GET')
    return await handleEpisodePreview(req,res);
   if(canary&&['GET','HEAD'].includes(req.method))
    return await handleCanary(req,res,canary[1]);
   if(path==='/api/v1/admin/content-hub/preflight'&&req.method==='GET'){
    const response=await request('/internal/pilot/preflight',{
      signal:AbortSignal.timeout(8000)});
    if(response.status!==200)return json(res,503,{
      ok:false,code:'movie_preflight_not_available',downloadStarted:false});
    const preflight=await safeReadJson(response);
    return json(res,200,{
      ok:true,code:'movie_metadata_checked',downloadStarted:false,
      providerMediaRequests:0,
      sourceName:preflight.sourceName==='saleh'?'saleh':null,
      gatewayId:Number.isSafeInteger(preflight.gatewayId)?
        preflight.gatewayId:null,
      extension:String(preflight.extension||'').slice(0,12),
      approvedMovieMatches:preflight.approvedMovieMatches===true,
      expectedBytes:Number.isSafeInteger(preflight.expectedBytes)?
        preflight.expectedBytes:null,
      storageRightsDeclared:preflight.storageRightsDeclared===true,
      sourceQuietDeclared:preflight.sourceQuietDeclared===true,
      sourceIdleDeclared:preflight.sourceIdleDeclared===true,
      uploadFeatureEnabled:preflight.uploadFeatureEnabled===true,
      automaticPilotEnabled:preflight.automaticPilotEnabled===true
    });
   }
   if(path==='/api/v1/admin/content-hub/episodes/confirmation'&&
      req.method==='GET'){
    const response=await request('/internal/episodes/playback/confirmation',{
     signal:AbortSignal.timeout(8000)});
    if(response.status!==200)return json(res,503,{
     ok:false,code:'episode_confirmation_unavailable'});
    return json(res,200,await safeReadJson(response));
   }
   if(path==='/api/v1/admin/content-hub/episodes/confirm'&&
      req.method==='POST'){
    if(req.headers['x-blofy-owner-action']!=='browser-av-tested')
     return json(res,403,{ok:false,code:'owner_playback_confirmation_required'});
    const input=await readSeasonAdminBody(req);
    if(input?.videoConfirmed!==true||input?.audioConfirmed!==true)
     return json(res,403,{ok:false,code:'owner_audio_and_video_required'});
    const response=await request('/internal/episodes/playback/confirm',{
     method:'POST',signal:AbortSignal.timeout(8000),extraHeaders:{
      'x-blofy-browser-confirm':'owner-saw-and-heard',
      'x-blofy-video-confirmed':'yes','x-blofy-audio-confirmed':'yes'
     }});
    return json(res,response.status,await response.json());
   }
   if(path==='/api/v1/admin/content-hub/seasons/pilot'&&req.method==='GET'){
    const result=await request('/internal/series/pilot',{
     signal:AbortSignal.timeout(9000)});
    if(result.status!==200)return json(res,503,{
     ok:false,code:'pilot_series_not_available'});
    return json(res,200,await safeReadJson(result));
   }
   if(path==='/api/v1/admin/content-hub/seasons/series'&&req.method==='GET'){
    const result=await request('/internal/series/candidates',{
     signal:AbortSignal.timeout(10000)});
    if(result.status!==200)return json(res,503,{
     ok:false,code:'licensed_series_catalog_unavailable'});
    return json(res,200,await safeReadJson(result));
   }
   const seasonSeries=/^\/api\/v1\/admin\/content-hub\/seasons\/series\/([1-9][0-9]{0,14})$/.exec(path);
   if(seasonSeries&&req.method==='GET'){
    const result=await request('/internal/series/episodes/'+seasonSeries[1],{
     signal:AbortSignal.timeout(65000)});
    if(result.status!==200)return json(res,503,{
     ok:false,code:'licensed_series_seasons_unavailable'});
    return json(res,200,await safeReadJson(result));
   }
   if(path==='/api/v1/admin/content-hub/seasons/queue'&&req.method==='GET'){
    const response=await request('/internal/seasons/queue',{
     signal:AbortSignal.timeout(8000)});
    if(response.status!==200)return json(res,503,{
     ok:false,code:'season_queue_unavailable'});
    return json(res,200,await safeReadJson(response));
   }
   const reportRoute=/^\\/api\\/v1\\/admin\\/content-hub\\/seasons\\/report\\/([a-z0-9][a-z0-9_-]{2,63})\\/page\\/([1-9][0-9]{0,4})$/.exec(path);
   if(reportRoute&&req.method==='GET'){
    const page=Number(reportRoute[2]);
    if(page>20000)return json(res,400,{
     ok:false,code:'season_report_page_invalid'});
    const response=await request('/internal/seasons/report/'+
     reportRoute[1]+'/page/'+page,{
     signal:AbortSignal.timeout(12000)});
    if(response.status===404)return json(res,404,{
     ok:false,code:'season_report_not_found'});
    if(response.status!==200)return json(res,503,{
     ok:false,code:'season_report_unavailable'});
    return json(res,200,await safeReadJson(response));
   }
   if(path==='/api/v1/admin/content-hub/seasons/analytics'&&req.method==='GET'){
    // Owner session already authenticated; do not leak private Hub token.
    const response=await request('/internal/seasons/analytics',{
     signal:AbortSignal.timeout(12000)});
    if(response.status!==200)return json(res,503,{
     ok:false,code:'season_analytics_unavailable'});
    return json(res,200,await safeReadJson(response));
   }
   if(path==='/api/v1/admin/content-hub/seasons/candidates'&&req.method==='GET'){
    const response=await request('/internal/episodes/candidates',{
     signal:AbortSignal.timeout(8000)});
    if(response.status!==200)return json(res,503,{
     ok:false,code:'episode_catalog_unavailable'});
    const result=await safeReadJson(response);
    return json(res,200,{ok:true,privateOnly:true,
     candidates:Array.isArray(result.candidates)?result.candidates:[],
     sourceMediaRequests:0});
   }
   if(path.startsWith('/api/v1/admin/content-hub/seasons/')&&
      req.method==='POST'){
    if(req.headers['x-blofy-owner-action']!=='season-library')
     return json(res,403,{ok:false,code:'season_owner_action_required'});
    if(path==='/api/v1/admin/content-hub/seasons/probe'){
     const input=await readSeasonAdminBody(req);
     const id=Number(input?.gatewayId);
     if(!Number.isSafeInteger(id)||id<1)return json(res,400,{
      ok:false,code:'episode_id_invalid'});
     const candidates=await request('/internal/episodes/candidates',{
      signal:AbortSignal.timeout(8000)});
     const catalog=await safeReadJson(candidates);
     if(!Array.isArray(catalog.candidates)||
       !catalog.candidates.some(c=>c.gatewayId===id))
      return json(res,403,{ok:false,code:'episode_not_approved'});
     const response=await request('/internal/episodes/probe',{
      method:'POST',signal:AbortSignal.timeout(60000),
      extraHeaders:{
       'x-blofy-episode-probe-confirm':'operator-approved-probe',
       'x-blofy-episode-gateway-id':String(id)}});
     return json(res,response.status===200?200:503,await response.json());
    }
    if(path==='/api/v1/admin/content-hub/seasons/enqueue'){
     const input=await readSeasonAdminBody(req);
     if(!input||typeof input!=='object'||Array.isArray(input))
      return json(res,400,{ok:false,code:'season_selection_invalid'});
     const response=await request('/internal/seasons/enqueue',{
      method:'POST',signal:AbortSignal.timeout(10000),
      extraHeaders:{
       'content-type':'application/json',
       'x-blofy-season-confirm':'licensed-private-episodes',
       'x-blofy-storage-rights-confirm':'licensed-persistent-copy'
      },body:JSON.stringify(input)});
     return json(res,response.status,await response.json());
    }
    const controls={
     '/api/v1/admin/content-hub/seasons/start':
      ['/internal/seasons/start','start-private-sequential'],
     '/api/v1/admin/content-hub/seasons/pause':
      ['/internal/seasons/pause','pause-private-sequential']
    };
    const command=controls[path];
    if(command){
     const response=await request(command[0],{
      method:'POST',signal:AbortSignal.timeout(8000),
      extraHeaders:{'x-blofy-season-confirm':command[1]}});
     return json(res,response.status,await response.json());
    }
   }
   if(path==='/api/v1/admin/content-hub/status'&&req.method==='GET')
    return await handleStatus(res);
   if(path==='/api/v1/admin/content-hub/batch/next'&&req.method==='POST'){
    // Strictly one approved operator request; no background polling/retries.
    const response=await request('/internal/batch/next',{
      method:'POST',confirmBatch:true,signal:AbortSignal.timeout(8000)});
    return json(res,response.status===202?202:409,{
      ok:response.status===202,code:response.status===202?
       'batch_accepted':'batch_not_ready_or_source_busy',
      automaticDownload:false,customerCutover:false});
   }
   if(path==='/api/v1/admin/content-hub/cancel'&&req.method==='POST'){
    const response=await request('/internal/pilot/cancel',{
      method:'POST',signal:AbortSignal.timeout(8000)});
    return json(res,response.status===202?202:409,{
      ok:response.status===202,code:response.status===202?
       'cancellation_requested':'pilot_not_running'});
   }
   return json(res,404,{ok:false,code:'not_found'});
  }catch{
   if(!res.headersSent&&!res.destroyed)
    return json(res,503,{ok:false,code:'content_hub_temporarily_unavailable'});
   if(!res.destroyed)res.destroy();
  }
 });
};
