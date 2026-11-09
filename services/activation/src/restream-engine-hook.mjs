// Admin-only status endpoint for BLOFY production restream engine.
// Does not route customer streams or change live/movie/series URLs.
import http from 'node:http';
import crypto from 'node:crypto';
import {normalizePrivateRestreamOrigin, publicRestreamState} from './restream-engine-core.mjs';
import {verifyRestreamSmoke} from './restream-smoke.mjs';
import {DEMO_PREFIX,serveRestreamDemo} from './restream-demo-hls.mjs';
import {checkDemoProxy} from './restream-demo-e2e.mjs';
import {publicHealthSummary,checkRestreamHealth,verifySyntheticConcurrency} from './restream-auto-health.mjs';
import {getRestreamMetrics} from './restream-observability.mjs';

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
let proxyCheckActive=false,proxyCheckedAt=0;
async function runProxyCheck(res){
  const now=Date.now();
  if(proxyCheckActive||(proxyCheckedAt&&now-proxyCheckedAt<30_000))
    return write(res,429,{ok:false,reason:'demo_proxy_rate_limited'});
  proxyCheckActive=true;proxyCheckedAt=now;
  try{
    const report=await checkDemoProxy({port:Number(process.env.PORT||3000),adminToken:ADMIN_TOKEN});
    return write(res,report.ok?200:503,report);
  }catch{
    return write(res,503,{ok:false,reason:'demo_proxy_failed',realSourceVerified:false});
  }finally{proxyCheckActive=false;}
}
if(process.env.BLOFY_RESTREAM_DEMO_E2E_ON_BOOT==='1'){
  // Exactly one synthetic, loopback-only end-to-end request per deployment.
  // Admin token stays in process memory, never logged or passed to the browser.
  const timer=setTimeout(()=>{
    void checkDemoProxy({port:Number(process.env.PORT||3000),adminToken:ADMIN_TOKEN})
      .then(report=>console.info('BLOFY_DEMO_HLS_PROXY_E2E',JSON.stringify(report)))
      .catch(()=>console.info('BLOFY_DEMO_HLS_PROXY_E2E',JSON.stringify({
        ok:false,reason:'demo_proxy_failed',realSourceVerified:false
      })));
  },24000);
  timer.unref?.();
}
let smokeRunning=false,smokeCheckedAt=0;
async function runSmoke(res){
  const now=Date.now();
  if(smokeRunning || (smokeCheckedAt>0&&now-smokeCheckedAt<30_000))
    return write(res,429,{ok:false,error:'restream_smoke_rate_limited'});
  smokeRunning=true;smokeCheckedAt=now;
  try{
    const report=await verifyRestreamSmoke(ENGINE);
    return write(res,report.ok?200:503,report);
  }finally{smokeRunning=false;}
}
if(process.env.BLOFY_RESTREAM_SMOKE_ON_BOOT==='1'){
  // One bounded synthetic test per deploy; no customer paths or provider
  // endpoints are requested. No repeating background polling.
  const timer=setTimeout(()=>{
    void verifyRestreamSmoke(ENGINE).then(report=>{
      console.info('BLOFY_RESTREAM_SYNTHETIC_SMOKE',JSON.stringify(report));
    }).catch(()=>console.info('BLOFY_RESTREAM_SYNTHETIC_SMOKE',JSON.stringify({
      ok:false,code:'restream_smoke_failed',realSourceVerified:false
    })));
  },22000);
  timer.unref?.();
}
// Disabled by default. Only probes the already configured synthetic 'smoke' path.
if(process.env.BLOFY_RESTREAM_AUTO_HEALTH==='1'){
  const interval=setInterval(()=>{
    void checkRestreamHealth({probe:()=>verifyRestreamSmoke(ENGINE)}).then(report=>{
      if(!report.ok && report.consecutiveFailures>=3)
        console.warn('BLOFY_RESTREAM_SYNTHETIC_ALERT',JSON.stringify({
          code:report.lastResult?.code,consecutiveFailures:report.consecutiveFailures
        }));
    }).catch(()=>{});
  },120_000);
  interval.unref?.();
}
let concurrencyRunning=false;
let concurrencyLastAt=0;
const previousCreateServer=http.createServer.bind(http);
http.createServer=function withBlofyRestreamHealth(listener){
  if(typeof listener!=='function')return previousCreateServer(listener);
  return previousCreateServer((req,res)=>{
    // Synthetic playback only. Every playlist/segment GET independently
    // authenticates through the existing admin session/Bearer layer.
    // No customer or third-party media can be requested via this route.
    if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/demo/check'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      void runProxyCheck(res);
      return;
    }
    if(req.url?.split('?')[0]?.startsWith(DEMO_PREFIX)){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      void serveRestreamDemo(req,res,{engineUrl:ENGINE});
      return;
    }
    if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/smoke'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      void runSmoke(res);
      return;
    }
    if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/metrics'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      if(process.env.BLOFY_RESTREAM_METRICS_READ!=='1')
        return write(res,503,{ok:false,code:'restream_metrics_not_enabled'});
      void getRestreamMetrics(ENGINE,{key:ADMIN_TOKEN}).then(report=>
        write(res,report.ok?200:503,report));
      return;
    }
    if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/auto-health'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      return write(res,200,publicHealthSummary());
    }
    if(req.method==='POST'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/auto-health/check'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      void checkRestreamHealth({probe:()=>verifyRestreamSmoke(ENGINE)}).then(report=>
        write(res,report.ok?200:report.code==='health_check_busy'||report.code==='health_check_cooldown'?429:503,report));
      return;
    }
    if(req.method==='POST'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/concurrency/check'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      // Fixed at two synthetic readers with a five-minute global cooldown.
      const now=Date.now();
      if(concurrencyRunning || (concurrencyLastAt && now-concurrencyLastAt<300000))
        return write(res,429,{ok:false,code:'synthetic_concurrency_rate_limited'});
      concurrencyRunning=true;concurrencyLastAt=now;
      void verifySyntheticConcurrency({probe:()=>verifyRestreamSmoke(ENGINE),concurrency:2})
        .then(report=>write(res,report.ok?200:503,report))
        .catch(()=>write(res,503,{ok:false,code:'synthetic_concurrency_failed'}))
        .finally(()=>{concurrencyRunning=false;});
      return;
    }
    if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/health'){
      if(!authorized(req.headers.authorization))return write(res,401,{ok:false,error:'unauthorized'});
      void status(res);
      return;
    }
    return listener(req,res);
  });
};
