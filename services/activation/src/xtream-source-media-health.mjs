import { validXtreamDenialHint } from './xtream-provider-denial.mjs';

// Sanitized, bounded operator-only record of source-media probes.
// Source credentials, upstream addresses, account names, titles, stream IDs
// and provider response bodies are never persisted in diagnostic snapshots.
const KINDS = new Set(['live','movie','series','episode']);
const REJECTED = new Set([401,403,456]);
export function summarizeSourceMediaProbe(mediaType,result,now=Date.now()){
  if(!KINDS.has(mediaType))throw new Error('invalid_source_probe_kind');
  const checks=Array.isArray(result?.checks)?result.checks.slice(0,8):[];
  const pass=checks.find(row=>row?.ok);
  const fail=checks.find(row=>!row?.ok);
  const chosen=result?.ok?pass:fail;
  const value=Number(chosen?.httpStatus);
  const httpStatus=Number.isInteger(value)&&value>=100&&value<=599?value:null;
  const ok=Boolean(result?.ok&&pass);
  return {
    checkedAt:new Date(now).toISOString(),
    ok,
    status:ok?'media-confirmed':REJECTED.has(httpStatus)?'provider-rejected':'unconfirmed',
    httpStatus,
    ...(validXtreamDenialHint(chosen?.providerHint)?{providerHint:validXtreamDenialHint(chosen.providerHint)}:{}),
    sampled:checks.length,
    failed:checks.filter(row=>row&&!row.ok).length
  };
}
export function sourceMediaSummary(probes={},now=Date.now()){
  if(!probes||typeof probes!=='object')return[];
  const labels={live:'القنوات',movie:'الأفلام',series:'بيانات المسلسلات',episode:'الحلقات'};
  return Object.entries(labels).flatMap(([kind,label])=>{
    const value=probes[kind];
    if(!value||typeof value!=='object')return[];
    const checked=Date.parse(value.checkedAt||'');
    // Do not present yesterday's upstream failure as current health.
    if(!Number.isFinite(checked)||checked>now+60_000||now-checked>24*3600_000)return[];
    const code=Number(value.httpStatus);
    const reasons={network_restriction:'قيد الشبكة',connection_limit:'حد الاتصالات',account_expired:'صلاحية الحساب',restream_not_allowed:'إعادة البث غير مصرح',output_format_rejected:'صيغة غير مسموحة',account_inactive:'الحساب غير نشط'};
    const hint=reasons[validXtreamDenialHint(value.providerHint)]||'';
    if(value.ok)return[{kind,label,className:'on',text:'✓ '+label+' · عينة نجحت'}];
    if(code===456)return[{kind,label,className:'off',text:'✕ '+label+' · رفض المصدر 456'+(hint?' · '+hint:'')}];
    if(code===401||code===403)return[{kind,label,className:'off',text:'✕ '+label+' · رفض المصدر '+code}];
    return[{kind,label,className:'hidden',text:'؟ '+label+' · فحص غير مؤكد'+(code>=400?' '+code:'')}];
  });
}
export function sourceAccountWarnings(info={},now=Date.now()){
  if(!info||typeof info!=='object')return[];
  const warnings=[];
  if(info.isRestreamer === false)
    warnings.push('المصدر يعلن أن هذا الحساب غير مخصص لإعادة البث (is_restreamer=0). اطلب حسابًا مصرحًا من المزود.');
  const expiry=Number(info.expiresAt);
  if(Number.isFinite(expiry)&&expiry>0&&expiry*1000<=now)
    warnings.push('انتهت صلاحية حساب المصدر حسب بيانات Xtream.');
  const active=Number(info.activeConnections),max=Number(info.maxConnections);
  if(info.activeConnections!==null&&info.activeConnections!==undefined&&
     info.maxConnections!==null&&info.maxConnections!==undefined&&
     Number.isInteger(active)&&Number.isInteger(max)&&max>0&&active>=max)
    warnings.push('المصدر يعلن أن الاتصالات المستخدمة بلغت الحد ('+active+'/'+max+').');
  const formats=Array.isArray(info.allowedOutputFormats)
    ?info.allowedOutputFormats.map(x=>String(x).toLowerCase()):[];
  if(formats.length&&!formats.includes('ts'))
    warnings.push('المصدر لا يعلن TS ضمن صيغ البث المسموح بها؛ راجع الصيغ المتاحة لدى المزود.');
  return warnings;
}
