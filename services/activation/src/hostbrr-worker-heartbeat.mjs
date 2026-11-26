import {authorizedHeartbeat} from './linode-heartbeat.mjs';
const path='/api/v1/internal/hostbrr-worker-heartbeat';
let db;
export function configureHostbrrWorkerHeartbeat(pool){db=pool;}
export function sanitizeHostbrrWorkerHeartbeat(p,now=Date.now()){
 const ts=Date.parse(p?.timestamp);
 if(p?.engineId!=='hostbrr'||p?.mode!=='monitoring-only'||
    p?.customerTrafficEnabled!==false||!Number.isFinite(ts)||ts<now-90000||ts>now+5000||
    !['inactive','opening','private_hls_ready','releasing','released','release_unverified','unknown'].includes(p?.workerStatus)||
    typeof p?.deliveryHealthy!=='boolean'||typeof p?.gatewayHealthy!=='boolean')
  throw Error('invalid_report');
 const valid=(x)=>Number.isSafeInteger(x)&&x>=0&&x<=1e12?x:null;
 // Deliberately exclude source credentials, channel IDs, signed URLs and capacity assertions.
 return {engineId:'hostbrr',mode:'monitoring-only',customerTrafficEnabled:false,
  timestamp:new Date(ts).toISOString(),workerStatus:p.workerStatus,
  deliveryHealthy:p.deliveryHealthy,gatewayHealthy:p.gatewayHealthy,
  memoryAvailableMiB:valid(p.memoryAvailableMiB),diskFreeMiB:valid(p.diskFreeMiB)};
}
export async function receiveHostbrrWorkerHeartbeat(req,res,url,json,env=process.env){
 if(url.pathname!==path)return false;
 if(req.method!=='POST'||url.search||env.BLOFY_HOSTBRR_HEARTBEAT_ENABLED!=='true'){
  json(res,404,{error:'not_found'});return true;
 }
 if(!authorizedHeartbeat(req.headers.authorization,env.BLOFY_HOSTBRR_HEARTBEAT_SHA256)){
  json(res,401,{error:'unauthorized'});return true;
 }
 const len=Number(req.headers['content-length']);
 if(!Number.isInteger(len)||len<1||len>2048||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){
  json(res,400,{error:'invalid_request'});return true;
 }
 let report;const timer=setTimeout(()=>req.destroy(),5000);
 try{
  const chunks=[];let n=0;
  for await(const chunk of req){n+=chunk.length;if(n>2048)throw Error('too_large');chunks.push(chunk);}
  if(n!==len)throw Error('length_mismatch');
  report=sanitizeHostbrrWorkerHeartbeat(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 }catch{if(!res.destroyed)json(res,400,{error:'invalid_report'});return true;}
 finally{clearTimeout(timer);}
 try{
  await db.query(`INSERT INTO blofy_hostbrr_worker_heartbeat(singleton,observed_at,report)
   VALUES(true,$1,$2::jsonb) ON CONFLICT(singleton) DO UPDATE
   SET observed_at=EXCLUDED.observed_at,report=EXCLUDED.report
   WHERE blofy_hostbrr_worker_heartbeat.observed_at<EXCLUDED.observed_at`,[report.timestamp,JSON.stringify(report)]);
  json(res,200,{ok:true});
 }catch{json(res,503,{error:'monitor_unavailable'});}
 return true;
}
export async function probeHostbrrWorkerHeartbeat(env=process.env){
 if(env.BLOFY_HOSTBRR_HEARTBEAT_ENABLED!=='true')return null;
 const start=Date.now(),result=(status,note)=>({id:'hostbrr-worker',name:'BLOFY HostBrr — حالة المحرك',tier:'test',httpStatus:null,status,note,latencyMs:Date.now()-start});
 try{
  const {rows}=await db.query("SELECT report FROM blofy_hostbrr_worker_heartbeat WHERE singleton=true AND observed_at>NOW()-INTERVAL '120 seconds' AND observed_at<=NOW()+INTERVAL '5 seconds'");
  const p=rows[0]?.report;
  if(!p)return result('offline','لم يصل تقرير حديث من المحرك');
  const healthy=p.deliveryHealthy&&p.gatewayHealthy&&!['unknown','release_unverified'].includes(p.workerStatus);
  return {...result(healthy?'healthy':'error','مراقبة فقط؛ لا تؤكد سعة المصدر أو تشغيل العملاء'),observedAt:p.timestamp,workerStatus:p.workerStatus};
 }catch{return result('offline','تعذر قراءة تقرير المحرك');}
}
