import crypto from 'node:crypto';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
export const DEVICE_INSIGHTS_PATH = '/api/v1/admin/device-insights';
const FILTERS = {
  all: ['كل الأجهزة', 'TRUE'],
  new24: ['جديدة خلال 24 ساعة', "d.created_at>=NOW()-INTERVAL '24 hours'"],
  new7: ['جديدة خلال 7 أيام', "d.created_at>=NOW()-INTERVAL '7 days'"],
  trial: ['التجربة سارية', "d.status='trial' AND (d.expires_at IS NULL OR d.expires_at>NOW())"],
  active: ['التفعيل ساري', "d.status='active' AND (d.expires_at IS NULL OR d.expires_at>NOW())"],
  lifetime: ['مدى الحياة', "d.status='active' AND d.expires_at IS NULL"],
  expiring: ['تنتهي خلال 7 أيام', "d.status IN ('active','trial') AND d.expires_at>NOW() AND d.expires_at<=NOW()+INTERVAL '7 days'"],
  expired: ['منتهية', "d.status='expired' OR (d.status IN ('active','trial') AND d.expires_at<=NOW())"],
  blocked: ['موقوفة', "d.status='blocked'"],
  empty: ['بدون قوائم', 'NOT EXISTS(SELECT 1 FROM device_playlists p WHERE p.device_id=d.device_id)'],
  errors: ['أخطاء مسجلة خلال 24 ساعة', "EXISTS(SELECT 1 FROM playback_diagnostics x WHERE x.device_id=d.device_id AND x.created_at>=NOW()-INTERVAL '24 hours' AND COALESCE(x.error_code,'')<>'')"]
};
const ORDERS = { newest:'d.created_at DESC,d.device_id', seen:'d.last_seen_at DESC NULLS LAST,d.device_id', expiry:'d.expires_at ASC NULLS LAST,d.device_id' };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const timestamp = value => value == null ? null : (Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : null);
export function insightOptions(params) {
  const rawPage=Number(params.get('page') || 1);
  return {filter:own(FILTERS,params.get('filter'))?params.get('filter'):'all',
    sort:own(ORDERS,params.get('sort'))?params.get('sort'):'newest',
    page:Number.isSafeInteger(rawPage)?Math.max(1,Math.min(1000,rawPage)):1,
    q:String(params.get('q') || '').trim().slice(0,64)};
}
export function safeDeviceInsight(row, now=Date.now()) {
  const expiresAt=timestamp(row.expires_at), firstRegisteredAt=timestamp(row.created_at);
  const expired=['active','trial'].includes(row.status) && expiresAt!==null && expiresAt<=now;
  const appVersion=typeof row.last_app_version==='string' && !/^web(?:-|$)/i.test(row.last_app_version) ? row.last_app_version.slice(0,64) : null;
  return {deviceId:row.device_id, status:expired?'expired':row.status, firstRegisteredAt,
    isNew:firstRegisteredAt!==null && firstRegisteredAt<=now && now-firstRegisteredAt<=86400000,
    trialStartedAt:timestamp(row.trial_started_at), expiresAt,
    remainingDays:['active','trial'].includes(row.status) && expiresAt!==null?Math.max(0,Math.ceil((expiresAt-now)/86400000)):null,
    lifetime:row.status==='active' && row.expires_at==null,
    lastContactAt:timestamp(row.last_seen_at), appVersion,
    reportedPlatform:String(row.last_platform || '').slice(0,32),
    playlistCount:Number(row.playlist_count || 0), lastPlaylistSavedAt:timestamp(row.last_playlist_saved_at),
    lastRecordedErrorAt:timestamp(row.last_error_at),lastRecordedErrorCode:String(row.last_error_code || '').slice(0,128)};
}
export async function loadDeviceInsights(pool, options, now=Date.now()) {
  const o=insightOptions(new URLSearchParams(options));
  const filter=FILTERS[o.filter][1], order=ORDERS[o.sort];
  const query=`SELECT d.device_id,d.status,d.created_at,d.trial_started_at,d.expires_at,d.last_seen_at,d.last_app_version,d.last_platform,
    p.playlist_count,p.last_playlist_saved_at,x.last_error_at,x.last_error_code
    FROM devices d
    LEFT JOIN LATERAL (SELECT COUNT(*)::int playlist_count,MAX(updated_at) last_playlist_saved_at
      FROM device_playlists WHERE device_id=d.device_id) p ON TRUE
    LEFT JOIN LATERAL (SELECT created_at last_error_at,error_code last_error_code FROM playback_diagnostics
      WHERE device_id=d.device_id AND COALESCE(error_code,'')<>'' ORDER BY created_at DESC LIMIT 1) x ON TRUE
    WHERE ($1='' OR POSITION(LOWER($1) IN LOWER(d.device_id))>0) AND (${filter})
    ORDER BY ${order} LIMIT 51 OFFSET $2`;
  const [rows,counts]=await Promise.all([pool.query(query,[o.q,(o.page-1)*50]),pool.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '24 hours')::int new24,
    COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '7 days')::int new7,
    COUNT(*) FILTER(WHERE status='trial' AND (expires_at IS NULL OR expires_at>NOW()))::int trial
    FROM devices`)]);
  return {options:o,counts:counts.rows[0],items:rows.rows.slice(0,50).map(row=>safeDeviceInsight(row,now)),hasMore:rows.rows.length>50,generatedAt:now};
}
function date(value) {return value==null?'غير متوفر':new Date(value).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'});}
export function renderDeviceInsights(data) {
  const o=data.options;
  const href=page=>DEVICE_INSIGHTS_PATH+'?'+new URLSearchParams({...o,page});
  const labels={active:'ساري',trial:'تجربة',expired:'منتهٍ',blocked:'موقوف'};
  const cards=data.items.map(item=>`<article class="card release-card"><div class="release-heading"><h2 dir="ltr">${escape(item.deviceId)}</h2><span class="badge">${item.isNew?'جهاز جديد — ':''}${escape(labels[item.status]||item.status)}</span></div>
    <dl>${[
      ['أول تسجيل في الخدمة',date(item.firstRegisteredAt)],['بداية التجربة',date(item.trialStartedAt)],
      ['آخر تواصل مع الخدمة',date(item.lastContactAt)],['نسخة التطبيق المسجلة',item.appVersion||'لم تصل نسخة التطبيق؛ آخر تواصل قد يكون من البوابة'],
      ['المنصة المبلّغة',item.reportedPlatform||'غير متوفرة'],['انتهاء التفعيل',item.lifetime?'مدى الحياة':date(item.expiresAt)],
      ['الأيام المتبقية',item.remainingDays==null?'—':item.remainingDays],['عدد القوائم المحفوظة',item.playlistCount],
      ['آخر حفظ لقائمة في الموقع',date(item.lastPlaylistSavedAt)],['آخر خطأ تشغيل مسجل',item.lastRecordedErrorCode||'لا توجد أخطاء مسجلة'],
      ['وقت الخطأ المسجل',date(item.lastRecordedErrorAt)]
    ].map(([label,value])=>`<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl><a class="btn" href="/admin#devices">إدارة التفعيل والقوائم</a></article>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07070d"><title>BLOFY — معلومات الأجهزة</title><link rel="stylesheet" href="/premium.css"><link rel="stylesheet" href="/release-manager.css"></head><body><main class="wrap"><header class="nav"><a class="brand" href="/admin">BLOFY PLAYER — الإدارة</a><a class="btn" href="/admin">رجوع للوحة الإدارة</a></header><section class="page-title"><h1>معلومات الأجهزة والجديد منها</h1><p>«جهاز جديد» يعني أول تسجيل في الخدمة خلال 24 ساعة، وليس إثبات وقت تحميل أو تثبيت التطبيق.</p><p class="caption">آخر تواصل قد يأتي من التطبيق أو بوابة الجهاز، ولا يثبت أن الجهاز متصل الآن. أوقات العرض بتوقيت السعودية.</p></section>
    <section class="metrics">${[['total','كل الأجهزة'],['new24','جديدة خلال 24 ساعة'],['new7','جديدة خلال 7 أيام'],['trial','تجارب سارية']].map(([key,label])=>`<div class="card metric"><strong>${Number(data.counts?.[key]||0)}</strong><span>${label}</span></div>`).join('')}</section>
    <form class="card toolbar" method="get" action="${DEVICE_INSIGHTS_PATH}"><label>بحث برقم الجهاز<input name="q" value="${escape(o.q)}" maxlength="64" dir="ltr"></label><label>التصفية<select name="filter">${Object.entries(FILTERS).map(([key,[label]])=>`<option value="${key}"${o.filter===key?' selected':''}>${label}</option>`).join('')}</select></label><label>الترتيب<select name="sort">${[['newest','الأحدث تسجيلًا'],['seen','آخر تواصل'],['expiry','الأقرب انتهاءً']].map(([key,label])=>`<option value="${key}"${o.sort===key?' selected':''}>${label}</option>`).join('')}</select></label><button class="primary" type="submit">عرض / تحديث</button><a class="btn" href="${DEVICE_INSIGHTS_PATH}">إلغاء التصفية</a></form>
    <p class="caption">صفحة ${o.page} — ${data.items.length} جهازًا. البيانات المعروضة لا تتضمن رموز الربط أو كلمات المرور. حفظ قائمة في الموقع لا يعني نجاح مزامنتها على الجهاز.</p><section class="two">${cards||'<p class="card">لا توجد أجهزة مطابقة.</p>'}</section><nav class="actions" aria-label="صفحات الأجهزة">${o.page>1?`<a class="btn" href="${escape(href(o.page-1))}">السابقة</a>`:''}${data.hasMore&&o.page<1000?`<a class="btn primary" href="${escape(href(o.page+1))}">التالية</a>`:''}</nav><footer class="foot">لتمديد جهاز أو مراجعة قوائمه: ارجع إلى الإدارة وابحث برقم الجهاز. تفاصيل العتاد والتعليق الفعلي تحتاج بيانات تشخيصية إضافية من التطبيق.</footer></main></body></html>`;
}
export function createDeviceInsightsHandler({pool,adminToken,now=Date.now}) {
  const limiter=createFixedWindowLimiter({limit:30,windowMs:60000});
  return async function handle(req,res) {
    const url=new URL(req.url||'/','http://localhost');if(url.pathname!==DEVICE_INSIGHTS_PATH)return false;
    const headers={'cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','x-robots-tag':'noindex',
      'content-security-policy':"default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'"};
    function send(status,body,type='application/json; charset=utf-8',extra={}) {const text=typeof body==='string'?body:JSON.stringify(body);res.writeHead(status,{...headers,...extra,'content-type':type,'content-length':Buffer.byteLength(text)});res.end(text);}
    const supplied=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+String(adminToken||''));
    if(!adminToken||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){send(401,{error:'unauthorized'});return true;}
    if(req.method!=='GET'){send(405,{error:'method_not_allowed'},undefined,{allow:'GET'});return true;}
    const rate=limiter.consume(requestClientKey(req),now());if(!rate.allowed){send(429,{error:'rate_limited'},undefined,{'retry-after':String(rate.retryAfterSeconds)});return true;}
    try {const data=await loadDeviceInsights(pool,insightOptions(url.searchParams),now());
      if(url.searchParams.get('format')==='json')send(200,data);else send(200,renderDeviceInsights(data),'text/html; charset=utf-8');
    }catch {send(503,{error:'device_insights_unavailable'});}
    return true;
  };
}
