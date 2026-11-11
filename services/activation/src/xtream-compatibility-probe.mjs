// Authenticated admin-only compatibility probe for one existing BLOFY account.
// The caller obtains credentials from its encrypted vault, never from clients.
// No catalog scan, upstream IPTV source request or media playback is performed.
import {normalizeXtreamPublicOrigin} from './xtream-public-origin.mjs';
export async function probeXtreamLogin({baseUrl,username,password,fetchImpl=fetch,timeoutMs=11000}={}){
  const base=normalizeXtreamPublicOrigin(baseUrl);
  if(!base)return {ok:false,code:'edge_not_configured',httpStatus:null};
  if(!username||!password)return {ok:false,code:'account_credentials_unavailable',httpStatus:null};
  const u=new URL('/player_api.php',base);
  u.searchParams.set('username',username);
  u.searchParams.set('password',password);
  const start=Date.now();
  try{
    const response=await fetchImpl(u,{
      redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(timeoutMs),
      headers:{'accept':'application/json','user-agent':'BLOFY-Xtream-Compatibility/1.0'}
    });
    const httpStatus=response.status;
    if(httpStatus!==200)return {ok:false,code:'edge_http_'+httpStatus,
      httpStatus,elapsedMs:Date.now()-start};
    const advertised=Number(response.headers.get('content-length')||0);
    if(advertised>32768)return {ok:false,code:'response_too_large',httpStatus};
    const payload=await response.text();
    if(payload.length>32768)return {ok:false,code:'response_too_large',httpStatus};
    let data;
    try{data=JSON.parse(payload)}catch{
      return {ok:false,code:'edge_invalid_json',httpStatus,elapsedMs:Date.now()-start};
    }
    const authenticated=data?.user_info?.auth===1||data?.user_info?.auth==='1';
    const serverInfo=data?.server_info||{};
    const originMatches=String(serverInfo.url||'').toLowerCase()===new URL(base).hostname.toLowerCase()&&
      String(serverInfo.server_protocol||'').toLowerCase()==='https';
    return {ok:authenticated&&originMatches,
      code:!authenticated?'account_auth_denied':originMatches?'xtream_login_compatible':'server_info_origin_mismatch',
      httpStatus,auth:authenticated?1:0,advertisedHostMatches:originMatches,
      elapsedMs:Date.now()-start};
  }catch{
    return {ok:false,code:'edge_unreachable_or_timeout',httpStatus:null,elapsedMs:Date.now()-start};
  }
}


// One bounded, credential-safe operator check of the actual Xtream client
// flows. No large stream lists, no playback and no M3U exports are requested.
async function readCompatibilityJson(response,maxBytes=1048576) {
  if(Number(response.headers.get('content-length')||0)>maxBytes)throw new Error('too_large');
  if(!response.body){
    const raw=await response.text();
    if(Buffer.byteLength(raw)>maxBytes)throw new Error('too_large');
    return JSON.parse(raw);
  }
  const reader=response.body.getReader();
  const chunks=[];
  let bytes=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes)throw new Error('too_large');
      chunks.push(value);
    }
  }finally{
    try{await reader.cancel()}catch{}
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks.map(b=>Buffer.from(b)),bytes).toString('utf8'));
}
async function requestCompatibilityJson({base,endpoint,params,method='GET',fetchImpl,timeoutMs}){
  const url=new URL(endpoint,base);
  let body;
  if(method==='POST')body=new URLSearchParams(params);
  else for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const response=await fetchImpl(url,{
    method,body,redirect:'manual',cache:'no-store',
    signal:AbortSignal.timeout(timeoutMs),
    headers:{
      accept:'application/json',
      ...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{}),
      'user-agent':'BLOFY-Xtream-Compatibility/1.1'
    }
  });
  if(response.status!==200)throw new Error('http_'+response.status);
  return readCompatibilityJson(response);
}
export async function probeXtreamAccountCompatibility({
  baseUrl,username,password,fetchImpl=fetch,timeoutMs=3800
}={}){
  const login=await probeXtreamLogin({baseUrl,username,password,fetchImpl,timeoutMs});
  if(!login.ok)return login;
  const base=normalizeXtreamPublicOrigin(baseUrl);
  const params={username,password};
  const tasks=[
    ['postLogin','/player_api.php',params,'POST'],
    ['panelLogin','/panel_api.php',params,'GET'],
    ['live','/player_api.php',{...params,action:'get_live_categories'},'GET'],
    ['movie','/player_api.php',{...params,action:'get_vod_categories'},'GET'],
    ['series','/player_api.php',{...params,action:'get_series_categories'},'GET']
  ];
  const results=await Promise.all(tasks.map(async([name,endpoint,p,method])=>{
    try {
      const value=await requestCompatibilityJson({
        base,endpoint,params:p,method,fetchImpl,timeoutMs
      });
      if(name==='postLogin'||name==='panelLogin'){
        const verified=value?.user_info?.auth===1||value?.user_info?.auth==='1';
        return [name,verified?{ok:true}:{ok:false,code:'auth_denied'}];
      }
      if(!Array.isArray(value))return[name,{ok:false,code:'invalid_categories_response'}];
      return[name,{ok:true,count:value.length}];
    }catch(error){
      const hint=String(error?.message||'');
      return[name,{ok:false,code:hint==='too_large'?'categories_too_large':
        /^http_\d{3}$/.test(hint)?hint:'unreachable_or_timeout'}];
    }
  }));
  const checks=Object.fromEntries(results);
  const failed=results.find(([,data])=>!data.ok);
  if(failed){
    return {ok:false,code:'xtream_flow_failure',httpStatus:login.httpStatus,
      auth:1,advertisedHostMatches:true,failedStep:failed[0],
      reason:failed[1].code,checks,elapsedMs:login.elapsedMs};
  }
  const categoryCounts={live:checks.live.count,movie:checks.movie.count,
    series:checks.series.count};
  const noCatalog=Object.values(categoryCounts).every(count=>count===0);
  return {ok:!noCatalog,code:noCatalog?'xtream_catalog_empty':'xtream_login_compatible',
    httpStatus:login.httpStatus,auth:1,advertisedHostMatches:true,
    postLogin:true,panelLogin:true,categories:categoryCounts,
    elapsedMs:login.elapsedMs,checks};
}
