// Diagnostic-only single HTTP/1.1 account request. It uses the exact saved
// Xtream endpoint and the SAME UA as checkedFetch; it changes only HTTP
// transport (Connection: close) to distinguish provider IP policy from client
// transport compatibility. No fallbacks, identity changes, proxy or bypass.
import http from 'node:http';
import https from 'node:https';
import {assertPublicXtreamUrl} from './xtream-core.mjs';
import {safeXtreamTransportCategory} from './xtream-transport-errors.mjs';

const responseCode=(code)=>Number.isInteger(code)&&code>=100&&code<=599?code:null;

export async function probeXtreamHttp11(url,{
  timeoutMs=7000,
  checkPublic=assertPublicXtreamUrl,
  httpTransport=http,
  httpsTransport=https
}={}){
  let target;
  try{
    target=new URL(url);
    if(!['http:','https:'].includes(target.protocol))throw Error('invalid_protocol');
    await checkPublic(target.origin);
  }catch(error){
    const known=error?.message==='xtream_private_host_blocked';
    return {ok:false,stage:'origin_validation',code:known?'xtream_private_host_blocked':
      safeXtreamTransportCategory(error)||'xtream_transport_unreachable',status:null};
  }
  return new Promise(resolve=>{
    let done=false,request=null;
    const finish=output=>{
      if(done)return;
      done=true;
      resolve(output);
    };
    try{
      const transport=target.protocol==='https:'?httpsTransport:httpTransport;
      request=transport.request(target,{
        method:'GET',agent:false,timeout:timeoutMs,
        headers:{'connection':'close','user-agent':'BLOFY-Xtream/1.0',
          'accept':'application/json,text/plain;q=0.8,*/*;q=0.1'}
      },response=>{
        const status=responseCode(response.statusCode);
        let bytes=0;const chunks=[];
        response.on('data',data=>{
          bytes+=data.length;
          if(bytes>500000){request.destroy(Object.assign(new Error('response_too_large'),{code:'EFBIG'}));return;}
          chunks.push(Buffer.from(data));
        });
        response.on('error',error=>finish({ok:false,stage:'http_response',status,
          code:safeXtreamTransportCategory(error)||'xtream_http_response_error'}));
        response.on('end',()=>{
          if(status!==200){
            finish({ok:false,stage:'http_response',status,code:status?'xtream_http_'+status:'xtream_http_invalid'});
            return;
          }
          try{
            const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const authenticated=payload?.user_info?.auth===1||payload?.user_info?.auth==='1';
            finish({ok:authenticated,stage:'http_response',status,
              code:authenticated?'xtream_api_reachable':'xtream_api_auth_or_payload_invalid'});
          }catch{finish({ok:false,stage:'http_response',status,code:'xtream_api_invalid_json'});}
        });
      });
      request.on('timeout',()=>request.destroy(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})));
      request.on('error',error=>finish({ok:false,stage:'http_connect',status:null,
        code:safeXtreamTransportCategory(error)||'xtream_transport_unreachable'}));
      request.end();
    }catch(error){finish({ok:false,stage:'http_connect',status:null,
      code:safeXtreamTransportCategory(error)||'xtream_transport_unreachable'});}
  });
}
