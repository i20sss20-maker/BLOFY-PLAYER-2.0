// Admin-only Xtream diagnostics. No upstream URLs, passwords or video bytes
// leave the probe. These helpers describe results without provider secrets.
import { XTREAM_DENIAL_MESSAGES,validXtreamDenialHint } from './xtream-provider-denial.mjs';
const EXTS = /^[a-z0-9]{2,8}$/;
const IDS = /^[A-Za-z0-9._-]{1,128}$/;

export function xtreamEpisodeSamples(payload, limit = 2) {
  const groups = payload && typeof payload === 'object' ? payload.episodes : null;
  if (!groups || typeof groups !== 'object') return {seasonCount:0,episodeCount:0,samples:[]};
  const seasons = Array.isArray(groups) ? [['1',groups]] : Object.entries(groups);
  let seasonCount=0, episodeCount=0;
  const samples=[];
  for (const [,rows] of seasons.slice(0,200)) {
    if (!Array.isArray(rows)) continue;
    seasonCount++;
    for (const row of rows.slice(0,3000)) {
      if (!row || typeof row !== 'object') continue;
      const id=String(row.id??'').trim();
      if (!IDS.test(id)) continue;
      episodeCount++;
      if (samples.length<limit) {
        const extension=String(row.container_extension||'mp4').replace(/^\./,'').toLowerCase();
        samples.push({id,extension:EXTS.test(extension)?extension:'mp4'});
      }
    }
  }
  return {seasonCount,episodeCount,samples};
}

// A healthy series can contain a missing first episode. Probe only a few
// distinct seasons/positions before judging the entire series unavailable.
export function xtreamEpisodePlaybackCandidates(payload, limit=3) {
  const groups=payload&&typeof payload==='object'?payload.episodes:null;
  if(!groups||typeof groups!=='object')return[];
  const seasons=(Array.isArray(groups)?[groups]:Object.values(groups))
    .filter(Array.isArray).slice(0,200);
  const max=Math.max(0,Math.min(6,Number(limit)||0));
  if(!max)return[];
  const seen=new Set(),selected=[];
  const pick=row=>{
    const id=String(row?.id??'').trim();
    if(!IDS.test(id)||seen.has(id))return;
    const extension=String(row.container_extension||'mp4').replace(/^\./,'').toLowerCase();
    seen.add(id);
    selected.push({id,extension:EXTS.test(extension)?extension:'mp4'});
  };
  for(const position of [0,-1,0.5]){
    for(const season of seasons){
      const rows=season.slice(0,3000);
      if(!rows.length)continue;
      const index=position===0.5?Math.floor(rows.length/2):position===-1?rows.length-1:0;
      pick(rows[index]);
      if(selected.length>=max)return selected;
    }
  }
  return selected;
}

const LABELS={live:'القناة',movie:'الفيلم',series:'المسلسل',episode:'الحلقة'};
const ERRORS={
  no_imported_items:'لا توجد عناصر مستوردة من هذا النوع. افحص مزامنة المصدر أولًا.',
  no_episode_info:'المصدر لم يُرجع تفاصيل الحلقات للمسلسل.',
  no_playable_episodes:'المصدر أعاد بيانات مسلسل بدون حلقات قابلة للتشغيل.',
  output_format_not_allowed:'المصدر لا يعلن TS أو M3U8 كصيغ بث مسموحة لهذا الحساب؛ راجع المزود.',
  series_response_invalid:'بيانات المسلسل غير صالحة (JSON).',
  series_response_too_large:'استجابة حلقات المسلسل تجاوزت حد فحص العينة.',
  empty_media:'المصدر لا يرسل أي بيانات فيديو.',
  upstream_html_instead_of_video:'المصدر أعاد صفحة HTML بدل الفيديو.',
  upstream_non_media_response:'المصدر أعاد رسالة خطأ أو بيانات نصية بدل ملف الفيديو، حتى لو كانت استجابة HTTP 200.' ,
  timeout:'انتهت مهلة استجابة المصدر (9.5 ثوانٍ).',
  redirect_invalid:'تحويل غير صالح من رابط المصدر.',
  xtream_redirect_invalid:'تحويل غير صالح من API المصدر.',
  xtream_private_host_blocked:'عنوان المصدر غير مسموح له بالوصول الداخلي.',
  upstream_unreachable:'تعذر الوصول إلى سيرفر المصدر.'
};
function summaryForCheck(row) {
  const code=Number(row?.httpStatus);
  const hint=XTREAM_DENIAL_MESSAGES[validXtreamDenialHint(row?.providerHint)]||'';
  const suffix=hint?' '+hint:'';
  if (code===401) return 'HTTP 401: المصدر رفض بيانات الدخول.'+suffix;
  if (code===403) return 'HTTP 403: المصدر يمنع تشغيل هذا المحتوى؛ راجع صلاحيات الحساب أو قيود الاتصال لدى المزود.'+suffix;
  if (code===456) return 'HTTP 456: رمز غير قياسي من المصدر؛ لا يمكن تأكيد السبب من الرمز وحده. تحقق من أذونات التشغيل وقيود حساب المصدر لدى المزود.'+suffix;
  if (code===404) return 'HTTP 404: ملف التشغيل أو API هذا المحتوى غير موجود لدى المصدر.'+suffix;
  if (code===429) return 'HTTP 429: تم تجاوز عدد طلبات/اتصالات المصدر.'+suffix;
  if (code>=500&&code<=599) return 'HTTP '+code+': خلل مؤقت في استجابة المصدر.';
  const err=String(row?.error||'').slice(0,80);
  const e=err.match(/^xtream_http_([0-9]{3})$/);
  if (e) return summaryForCheck({httpStatus:Number(e[1])});
  return ERRORS[err] || 'المصدر لم يقدّم بيانات تشغيل صالحة.';
}

export function xtreamProbeMessage(result, kind='live') {
  const label=LABELS[kind]||'المحتوى';
  const checks=Array.isArray(result?.checks)?result.checks:[];
  if (result?.ok) {
    const pass=checks.find(x=>x?.ok);
    const status=pass?.httpStatus ? 'HTTP '+pass.httpStatus+' · ' : '';
    const episodes=pass?.episodeCount ? ' · عدد الحلقات: '+pass.episodeCount : '';
    const fallback=pass?.rangeFallbackUsed?' · المصدر رفض Range لكن استجاب لطلب فيديو عادي':'';
    const failed=checks.filter(x=>x&&!x.ok).length;
    const partial=failed?' · نجح بعد تعثر '+failed+' من العينات الأخرى':'';
    return 'نجح فحص '+label+': '+status+'وصلت استجابة صحيحة'+episodes+fallback+partial+'. هذا فحص تقني وليس تشغيل صوت وصورة كاملًا.';
  }
  if (result?.reason==='no_imported_items') return 'تعذر فحص '+label+': '+ERRORS.no_imported_items;
  if (result?.reason==='output_format_not_allowed') return 'تعذر فحص '+label+': '+ERRORS.output_format_not_allowed;
  const diagnostics=checks.filter(Boolean).slice(0,2).map(summaryForCheck);
  return 'فشل فحص '+label+': '+(diagnostics.length?diagnostics.join(' | '):'تعذر التأكد من المصدر.');
}
