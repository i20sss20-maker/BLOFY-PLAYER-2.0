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
