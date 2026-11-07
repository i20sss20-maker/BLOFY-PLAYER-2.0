// Controlled, one-shot connectivity diagnostics from the *production portal*
// container. Public-IP services are fixed, trusted HTTPS endpoints. Source
// checks never request playlists, transmit credentials or modify a catalog.
import net from 'node:net';
import tls from 'node:tls';
import {normalizeXtreamBaseUrl,assertPublicXtreamUrl,isBlockedNetworkAddress} from './xtream-core.mjs';
import {safeXtreamTransportCategory} from './xtream-transport-errors.mjs';

const CHECKS=Object.freeze([
  'https://api.ipify.org/',
  'https://checkip.amazonaws.com/',
  'https://ipv4.icanhazip.com/'
]);

export function parsePublicEgressIPv4(text){
  const value=String(text||'').trim();
  return net.isIP(value)===4&&!isBlockedNetworkAddress(value)?value:null;
}

export async function observeRailwayEgress({fetchImpl=fetch}={}){
  const results=await Promise.all(CHECKS.map(async url=>{
    try{
      const response=await fetchImpl(url,{redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(4500)});
      if(response.status!==200)return null;
      const body=await response.text();
      if(body.length>128)return null;
      return parsePublicEgressIPv4(body);
    }catch{return null;}
  }));
  const observedIps=[...new Set(results.filter(Boolean))];
  return {checked:CHECKS.length,responses:results.filter(Boolean).length,observedIps};
}

function connectOnce(target,timeoutMs=4000){
  return new Promise(resolve=>{
    const host=target.hostname;
    const port=Number(target.port)||(target.protocol==='https:'?443:80);
    const secure=target.protocol==='https:';
    let done=false,tcpConnected=false;
    const socket=secure
      ?tls.connect({host,port,servername:net.isIP(host)?undefined:host,rejectUnauthorized:true})
      :net.createConnection({host,port});
    const finish=(result)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    socket.on('connect',()=>{tcpConnected=true;if(!secure)finish({ok:true,stage:'tcp',code:'connected'});});
    if(secure)socket.on('secureConnect',()=>finish({ok:true,stage:'tls',code:'connected'}));
    socket.on('error',error=>finish({ok:false,stage:tcpConnected?'tls':'tcp',
      code:safeXtreamTransportCategory(error)||'xtream_transport_unreachable'}));
    const timer=setTimeout(()=>finish({ok:false,stage:tcpConnected?'tls':'tcp',
      code:'xtream_transport_timeout'}),timeoutMs);
    timer.unref?.();
  });
}

export async function probeXtreamSocket(baseUrl,{
  checkPublic=assertPublicXtreamUrl,dial=connectOnce
}={}){
  let target;
  try{
    target=new URL(normalizeXtreamBaseUrl(baseUrl));
    await checkPublic(target.origin);
  }catch(error){
    return {ok:false,stage:'dns_or_host',
      code:safeXtreamTransportCategory(error)||
        (error?.message==='xtream_private_host_blocked'?'xtream_private_host_blocked':'xtream_host_unresolved')};
  }
  try{
    const result=await dial(target,4000);
    const stage=['tcp','tls'].includes(result?.stage)?result.stage:'tcp';
    if(result?.ok)return {ok:true,stage,code:'connected'};
    const code=String(result?.code||'');
    const allowed=/^xtream_transport_(?:dns_failed|connection_refused|connection_reset|timeout|tls_invalid|unreachable)$/;
    return {ok:false,stage,code:allowed.test(code)?code:'xtream_transport_unreachable'};
  }catch(error){
    return {ok:false,stage:'tcp',
      code:safeXtreamTransportCategory(error)||'xtream_transport_unreachable'};
  }
}
