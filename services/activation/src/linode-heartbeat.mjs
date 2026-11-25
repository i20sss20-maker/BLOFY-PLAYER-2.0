import {createHash,timingSafeEqual} from 'node:crypto';
const PATH='/api/v1/internal/linode-heartbeat';
let db;
export function configureLinodeHeartbeat(pool){db=pool;}
const base={id:'linode-engine',name:'BLOFY ENGINE PRO — Linode',tier:'test',httpStatus:null};
export function authorizedHeartbeat(header,digest){
  if(typeof header!=='string'||!/^Bearer [a-f0-9]{64}$/.test(header)||! /^[a-f0-9]{64}$/.test(digest||''))return false;
  return timingSafeEqual(createHash('sha256').update(header.slice(7)).digest(),Buffer.from(digest,'hex'));
}
export function sanitizeHeartbeat(p,now=Date.now()){
  const ts=Date.parse(p?.timestamp);
  if(p?.product!=='BLOFY ENGINE PRO'||p?.mode!=='monitoring-only'||!Number.isFinite(ts)||
     ts>now+5000||ts<now-90000||!['HEALTHY','DEGRADED','UNHEALTHY','ERROR'].includes(p.status)||
     !Number.isSafeInteger(p.alert_count)||p.alert_count<0||p.alert_count>100000||
     typeof p.live?.healthy!=='boolean'||typeof p.timeshift?.healthy!=='boolean')
    throw Error('invalid_report');
  const number=(n)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12?n:null;
  return {timestamp:new Date(ts).toISOString(),status:p.status,alert_count:p.alert_count,
    live:{healthy:p.live.healthy},timeshift:{healthy:p.timeshift.healthy},
    catalog_total:number(p.catalog_total),
    resources:{memory_available_GiB:number(p.resources?.memory_available_GiB),disk_free_GiB:number(p.resources?.disk_free_GiB)}};
}
export async function receiveLinodeHeartbeat(req,res,url,json,env=process.env){
  if(url.pathname!==PATH)return false;
  if(req.method!=='POST'||url.search||env.BLOFY_LINODE_HEARTBEAT_ENABLED!=='true'){
    json(res,404,{error:'not_found'});return true;
  }
  if(!authorizedHeartbeat(req.headers.authorization,env.BLOFY_LINODE_HEARTBEAT_SHA256)){
    json(res,401,{error:'unauthorized'});return true;
  }
  const len=Number(req.headers['content-length']);
  if(!Number.isInteger(len)||len<1||len>4096||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){
    json(res,400,{error:'invalid_request'});return true;
  }
  let report;const timer=setTimeout(()=>req.destroy(),5000);
  try{
    const chunks=[];let n=0;
    for await(const chunk of req){n+=chunk.length;if(n>4096)throw Error('too_large');chunks.push(chunk);}
    if(n!==len)throw Error('length_mismatch');
    report=sanitizeHeartbeat(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }catch{if(!res.destroyed)json(res,400,{error:'invalid_report'});return true;}
  finally{clearTimeout(timer);}
  try{
    await db.query(`INSERT INTO blofy_linode_heartbeat(singleton, observed_at, report)
      VALUES (true,$1,$2::jsonb) ON CONFLICT(singleton) DO UPDATE
      SET observed_at=EXCLUDED.observed_at,report=EXCLUDED.report
      WHERE blofy_linode_heartbeat.observed_at<EXCLUDED.observed_at`,[report.timestamp,JSON.stringify(report)]);
    json(res,200,{ok:true});
  }catch{json(res,503,{error:'monitor_unavailable'});}
  return true;
}
export async function probeLinodeHeartbeat(env=process.env){
  if(env.BLOFY_LINODE_HEARTBEAT_ENABLED!=='true')return null;
  const start=Date.now();
  const result=(status,note)=>({...base,status,note,latencyMs:Date.now()-start});
  if(!/^[a-f0-9]{64}$/.test(env.BLOFY_LINODE_HEARTBEAT_SHA256||''))return result('error','إعداد مصادقة HTTPS غير مكتمل');
  try{
    const r=await db.query('SELECT report FROM blofy_linode_heartbeat WHERE singleton=true AND observed_at > NOW() - INTERVAL \'120 seconds\' AND observed_at <= NOW() + INTERVAL \'5 seconds\'');
    const p=r.rows[0]?.report;
    if(!p)return result('offline','لم يصل تقرير حديث عبر HTTPS');
    const healthy=p.status==='HEALTHY'&&p.alert_count===0&&p.live?.healthy===true&&p.timeshift?.healthy===true;
    return {...result(healthy?'healthy':'error',healthy?'تقرير HTTPS حديث من المحرك المعزول؛ لا يثبت تشغيل العملاء':'المحرك أبلغ عن مشكلة'),observedAt:p.timestamp,catalogTotal:p.catalog_total,resources:p.resources};
  }catch{return result('offline','تعذر قراءة تقرير المحرك');}
}
