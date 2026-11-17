// Admin-only, read-only service monitor. No customer data and no arbitrary URL inputs.
import { readFile } from 'node:fs/promises';
import {siteOperatorReadiness} from './site-operator-readiness.mjs';

export const CONTROL_CENTER_TARGETS = Object.freeze([
  Object.freeze({ id:'player', label:'موقع BLOFY PLAYER', tier:'production', endpoint:'https://blofyplayer.com/health' }),
  Object.freeze({ id:'updates', label:'خدمة التطبيقات والتحديثات', tier:'production', endpoint:'https://updates.blofyplayer.com/health' }),
  Object.freeze({ id:'stream', label:'واجهة BLOFY STREAM', tier:'production', endpoint:'https://blofy-stream-api-production.up.railway.app/health' }),
  Object.freeze({ id:'decoder', label:'مختبر FFmpeg المعزول', tier:'test', endpoint:'https://blofy-decoder-lab-test.up.railway.app/health' })
]);
const CACHE_MS=25_000;
const PROBE_TIMEOUT_MS=4500;
const MAX_HISTORY=24;
const MAX_HEALTH_BODY_BYTES=4096;
let cached=null;
let cachedAt=0;
let pending=null;
const history=[];
export function classifyControlCenterStatus(status) {
  if(Number.isInteger(status) && status>=200 && status<=299)return 'healthy';
  if(Number.isInteger(status) && status>=300 && status<=499)return 'reachable';
  return 'error';
}
export async function checkHealthPayload(response){
  const type=String(response.headers?.get?.('content-type')||'').toLowerCase();
  if(!type.includes('application/json')||!response.body?.getReader)
    return {isHealthJson:false,explicitlyUnhealthy:false};
  const reader=response.body.getReader();
  let bytes=0,parts=[];
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value?.byteLength||0;
      if(bytes>MAX_HEALTH_BODY_BYTES)
        return {isHealthJson:false,explicitlyUnhealthy:false};
      parts.push(Buffer.from(part.value));
    }
    const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
    const explicitFailure=payload?.ok===false||
      payload?.healthy===false||payload?.status==='error'||
      payload?.status==='unhealthy'||payload?.status==='down';
    return {isHealthJson:true,explicitlyUnhealthy:explicitFailure,
      explicitlyHealthy:!explicitFailure&&(
        payload?.ok===true||payload?.healthy===true||
        ['ok','healthy','online','up'].includes(payload?.status))};
  }catch{return {isHealthJson:false,explicitlyUnhealthy:false};}
  finally{try{await reader.cancel();}catch{}try{reader.releaseLock()}catch{}}
}
export async function probeControlCenterTarget(target, fetchImpl=fetch, now=Date.now) {
  const started=now();
  const controller=new AbortController();
  const stop=setTimeout(()=>controller.abort(),PROBE_TIMEOUT_MS);
  try {
    const response=await fetchImpl(target.endpoint,{
      method:'GET',redirect:'manual',signal:controller.signal,
      headers:{accept:'application/json,text/plain,*/*;q=0.1','user-agent':'BLOFY-Control-Center-Admin/1.0'}
    });
    const payload=await checkHealthPayload(response);
    const verdict=classifyControlCenterStatus(response.status);
    // HTTP 200 alone cannot prove the underlying service is healthy.
    const status=payload.explicitlyUnhealthy?'error':
      verdict==='healthy'&&!payload.explicitlyHealthy?'reachable':verdict;
    return {
      id:target.id,name:target.label,tier:target.tier,
      status,
      httpStatus:response.status,latencyMs:Math.max(0,now()-started),
      note:payload.explicitlyUnhealthy?
        'الخادم متصل لكنه أبلغ عن حالة غير سليمة؛ لا تُعدّ الخدمة جاهزة':
        status==='healthy'
          ? 'أكدت استجابة الصحة جاهزية الخدمة؛ لا يثبت ذلك تشغيل الوسائط'
          : response.status>=200 && response.status<=299
            ? 'استجاب HTTP، لكن فحص جاهزية الخدمة غير مؤكد'
            : 'الخادم ردّ برمز HTTP لا يؤكد جاهزية الخدمة'
    };
  } catch(error) {
    return {
      id:target.id,name:target.label,tier:target.tier,
      status:'offline',httpStatus:null,latencyMs:Math.max(0,now()-started),
      note:controller.signal.aborted?'انتهت مهلة الاتصال':'تعذر الوصول إلى الخدمة'
    };
  } finally {clearTimeout(stop);}
}
export async function controlCenterSnapshot() {
  if(cached && Date.now()-cachedAt<CACHE_MS)return cached;
  if(pending)return pending;
  pending=(async()=>{
    const [checks,operatorReadiness]=await Promise.all([
      Promise.all(CONTROL_CENTER_TARGETS.map(target=>probeControlCenterTarget(target))),
      siteOperatorReadiness()
    ]);
    const result={
      product:'BLOFY CONTROL CENTER',version:1,mode:'read-only',
      checkedAt:new Date().toISOString(),
      checks,
      operatorReadiness,
      summary:{
        total:checks.length,
        healthy:checks.filter(c=>c.status==='healthy').length,
        reachable:checks.filter(c=>c.status==='reachable').length,
        failed:checks.filter(c=>['error','offline'].includes(c.status)).length
      },
      scope:'HTTP service reachability only; no media playback or audio inspection',
      phases:[
        {label:'إدارة STREAM والمصادر والمكتبة',state:'available'},
        {label:'الأكواد والمشتركون ولوحات الموزعين',state:'available'},
        {label:'فحص HLS وعينات الصوت والصورة',state:'manual'},
        {label:'مختبر FFmpeg المستقل',state:'synthetic'},
        {label:'التخزين والمزامنة ضمن لوحة المكتبة',state:'available'},
        {label:'تأكيد تشغيل القنوات على أجهزة حقيقية',state:'not_verified'}
      ]
    };
    cached=result;cachedAt=Date.now();
    history.push({checkedAt:result.checkedAt,summary:result.summary});
    while(history.length>MAX_HISTORY)history.shift();
    return result;
  })();
  try{return await pending;}finally{pending=null;}
}
const ASSETS=Object.freeze({
  page:{file:'admin-control-center.html',type:'text/html; charset=utf-8'},
  css:{file:'admin-control-center.css',type:'text/css; charset=utf-8'},
  js:{file:'admin-control-center.js',type:'text/javascript; charset=utf-8'}
});
export async function controlCenterAsset(key) {
  const asset=ASSETS[key];
  if(!asset)throw new Error('unknown_control_center_asset');
  const content=await readFile(new URL('../web/'+asset.file,import.meta.url));
  return {content,type:asset.type};
}
