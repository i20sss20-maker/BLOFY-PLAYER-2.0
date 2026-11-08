// Read-only comparison of the configured Xtream API origin with the
// provider-advertised media origin in player_api.php / server_info.
// A mismatch explains why API login can succeed while /movie and /series
// fail on the configured host. No automatic redirect or source mutation.
import {normalizeXtreamBaseUrl} from './xtream-core.mjs';

function providerOrigin(server){
  if(!server||typeof server!=='object'||Array.isArray(server))return null;
  const raw=String(server.url||'').trim();
  if(!raw||raw.length>255||/[\\\s@?#]/.test(raw))return null;
  const protocol=String(server.server_protocol||'http').toLowerCase();
  if(!['http','https'].includes(protocol))return null;
  let url;
  try{url=new URL(/^https?:\/\//i.test(raw)?raw:protocol+'://'+raw)}
  catch{return null;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
     url.search||url.hash||url.pathname!=='/')return null;
  const hostname=url.hostname.toLowerCase();
  if(hostname==='localhost'||hostname.endsWith('.localhost')||
     hostname.endsWith('.local')||hostname.endsWith('.internal'))return null;
  const port=String(url.protocol==='https:'?server.https_port||server.port||'':
    server.port||'').trim();
  if(!url.port&&port){
    if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)return null;
    url.port=port;
  }
  return url.origin;
}
export function compareXtreamAdvertisedOrigin(configuredBase,serverInfo){
  let configured,advertised;
  try{configured=new URL(normalizeXtreamBaseUrl(configuredBase))}
  catch{return {ok:false,code:'configured_origin_invalid'};}
  try{advertised=providerOrigin(serverInfo)}
  catch{return {ok:false,code:'advertised_origin_invalid'};}
  if(!advertised)return {ok:false,code:'advertised_origin_not_provided'};
  const suggested=new URL(advertised);
  return {ok:true,code:configured.origin===suggested.origin?
    'origin_matches':'origin_differs',
    hostDiffers:configured.hostname!==suggested.hostname,
    portDiffers:configured.port!==suggested.port,
    protocolDiffers:configured.protocol!==suggested.protocol,
    configuredHasPathPrefix:configured.pathname!=='/',
    // Only booleans go to logs. Never expose the upstream hostname/URL.
    mediaOriginChanged:configured.origin!==suggested.origin};
}
