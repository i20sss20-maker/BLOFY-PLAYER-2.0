// Admin-only status endpoint for BLOFY production restream engine.
// Does not route customer streams or change live/movie/series URLs.
import http from 'node:http';
import crypto from 'node:crypto';
import {normalizePrivateRestreamOrigin, publicRestreamState} from './restream-engine-core.mjs';

const ENGINE = normalizePrivateRestreamOrigin(process.env.BLOFY_RESTREAM_ENGINE_URL || '');
const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();

function write(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'content-length':Buffer.byteLength(body)});
  res.end(body);
}
function authorized(value){
  if(!ADMIN_TOKEN)return false;
  const expected=Buffer.from('Bearer '+ADMIN_TOKEN);
  const actual=Buffer.from(String(value||''));
  return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
}
async function status(res) {
  if(!ENGINE)return write(res,200,{ok:false,...publicRestreamState()});
  const started=Date.now();
  try{
    const response=await fetch(ENGINE+'/',{method:'GET',redirect:'manual',signal:AbortSignal.timeout(4000),headers:{accept:'text/plain'}});
    await response.body?.cancel().catch(()=>{});
    return write(res,200,{ok:true,...publicRestreamState({configured:true,responded:true,httpStatus:response.status,elapsedMs:Date.now()-started})});
  }catch{
    return write(res,503,{ok:false,...publicRestreamState({configured:true,responded:false,elapsedMs:Date.now()-started})});
  }
}
const previousCreateServer=http.createServer.bind(http);
http.createServer=function withBlofyRestreamHealth(listener){
  if(typeof listener!=='function')return previousCreateServer(listener);
  return previousCreateServer((req,res)=>{
    if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/health'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      void status(res);
      return;
    }
    return listener(req,res);
  });
};
