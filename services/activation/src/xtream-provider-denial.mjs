// Inspect only a tiny snippet of a rejected upstream response in memory.
// Never return, log, or persist any upstream body, URL, credentials or IPs.
// A hint describes the provider's own wording; it is not a universal meaning
// of non-standard HTTP statuses such as 456.
const DENIAL_PATTERNS=[
  ['network_restriction',/(?:\b(?:ip|isp|country|region|geo(?:graphic|location)?)\b.{0,42}\b(?:lock(?:ed)?|restrict(?:ed)?|block(?:ed)?|denied|not allowed)\b|\b(?:lock(?:ed)?|restrict(?:ed)?|block(?:ed)?|denied|not allowed)\b.{0,42}\b(?:ip|isp|country|region|geo(?:graphic|location)?)\b)/i],
  ['connection_limit',/\b(?:too many (?:active )?(?:connections|streams)|(?:max(?:imum)?|limit(?:ed)?) (?:active )?(?:connections|streams)|connection limit|concurrent (?:stream|connection) limit|already watching)\b/i],
  ['account_expired',/\b(?:account|subscription|line|playlist)?\s*(?:has )?expired\b/i],
  ['restream_not_allowed',/\b(?:restream(?:ing|er)?\s+(?:not allowed|disabled|denied|forbidden)|not allowed to restream)\b/i],
  ['output_format_rejected',/\b(?:(?:output )?(?:format|extension|container)\s+(?:not allowed|unsupported|not supported|denied)|(?:ts|m3u8)\s+(?:not allowed|unsupported|not supported))\b/i],
  ['account_inactive',/\b(?:(?:account|subscription|line)\s+(?:blocked|disabled|suspended|banned)|(?:blocked|disabled|suspended|banned)\s+(?:account|subscription|line))\b/i]
];
const HINTS=new Set(DENIAL_PATTERNS.map(([kind])=>kind));
export function validXtreamDenialHint(value){
  return HINTS.has(value)?value:null;
}
export function classifyXtreamProviderDenial(input){
  const text=String(input||'').slice(0,2048);
  for(const [kind,regex] of DENIAL_PATTERNS)if(regex.test(text))return kind;
  return null;
}
export async function readXtreamProviderDenialHint(response){
  if(!response||![401,403,404,429,456].includes(response.status))return null;
  let reader;
  try{
    // Header hints can be used as well, but raw header values are never exposed.
    const header=[
      response.headers?.get('x-error-reason')||'',
      response.headers?.get('x-error-message')||''
    ].join(' ');
    const fromHeader=classifyXtreamProviderDenial(header);
    if(fromHeader)return fromHeader;
    if(!response.body)return null;
    reader=response.body.getReader();
    const first=await reader.read();
    if(first.done||!first.value)return null;
    return classifyXtreamProviderDenial(Buffer.from(first.value).subarray(0,2048).toString('utf8'));
  }catch{
    return null;
  }finally{
    if(reader){
      try{await reader.cancel()}catch{}
      try{reader.releaseLock()}catch{}
    }else if(response?.body){
      try{await response.body.cancel()}catch{}
    }
  }
}
export const XTREAM_DENIAL_MESSAGES=Object.freeze({
  network_restriction:'المصدر أشار إلى قيد عنوان IP أو الدولة أو مزود الشبكة؛ اطلب من المزود اعتماد اتصال السيرفر.',
  connection_limit:'المصدر أشار إلى بلوغ حد المشاهدات المتزامنة؛ راجع الاتصالات المصرح بها مع المزود.',
  account_expired:'المصدر أشار إلى انتهاء صلاحية الحساب؛ راجع الاشتراك لدى المزود.',
  restream_not_allowed:'المصدر أشار إلى أن إعادة البث غير مصرح بها لهذا الحساب؛ اطلب التصريح المناسب من المزود.',
  output_format_rejected:'المصدر أشار إلى أن صيغة التشغيل غير مسموحة؛ راجع صيغ الإخراج المتاحة للحساب.',
  account_inactive:'المصدر أشار إلى أن الحساب معطّل أو محظور؛ راجع حالته لدى المزود.'
});
