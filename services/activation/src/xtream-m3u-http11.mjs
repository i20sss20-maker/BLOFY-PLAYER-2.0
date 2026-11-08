// A fresh HTTP/1.1 socket for a single operator-approved official M3U audit.
// Used ONLY when the native fetch transport throws before an HTTP response.
// The provider never receives a second request after an actual HTTP denial.
import http from 'node:http';
import https from 'node:https';
import {Readable} from 'node:stream';
export function getXtreamManifestHttp11(target,{signal}={}){
 const u=new URL(target);
 if(!['http:','https:'].includes(u.protocol)||
   !u.pathname.endsWith('/get.php'))throw Error('m3u_http11_target_invalid');
 return new Promise((resolve,reject)=>{
  const request=(u.protocol==='https:'?https:http).request(u,{
   method:'GET',agent:false,signal,
   headers:{'user-agent':'BLOFY-Xtream-Audit/1.0',
    accept:'audio/x-mpegurl,text/plain,*/*',
    'accept-encoding':'identity',connection:'close'}
  },res=>{
   const status=res.statusCode||502;
   const contentType=String(res.headers['content-type']||'');
   try{
    resolve(new Response([204,304].includes(status)?null:Readable.toWeb(res),
     {status,headers:{'content-type':contentType}}));
   }catch{res.destroy();reject(Error('http11_invalid_response'))}
  });
  request.setTimeout(30000,()=>request.destroy(Error('http11_timeout')));
  request.once('error',()=>reject(Error('http11_transport_unavailable')));
  request.end();
 });
}
