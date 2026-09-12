/** Public downloads are server-rendered: no JavaScript, fetch or WebView feature is required. */
const PATHS = new Set(['/downloads', '/downloads/', '/releases', '/releases/']);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);

function apkUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && /\.apk$/i.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

export function renderPublicDownloads(items = [], { unavailable = false } = {}) {
  const releases = (Array.isArray(items) ? items : []).filter(item => item &&
    Number.isSafeInteger(Number(item.versionCode)) && Number(item.versionCode) > 0 &&
    typeof item.versionName === 'string' && item.versionName.length > 0 && item.versionName.length <= 64 && apkUrl(item.downloadUrl))
    .slice(0, 200).sort((a, b) => Number(b.isPrimary === true) - Number(a.isPrimary === true) || Number(b.versionCode) - Number(a.versionCode));
  const primary = releases.find(item => item.isPrimary === true);
  const cards = releases.map(item => `<article class="card release-card${item.isPrimary === true ? ' release-primary' : ''}" data-version-code="${Number(item.versionCode)}">
    <div class="release-heading"><h2 dir="ltr">${escapeHtml(item.versionName)}</h2><span class="badge">${item.isPrimary === true ? '★ الإصدار الأساسي' : item.channel === 'stable' ? 'معتمد' : 'تجريبي'}</span></div>
    <p class="caption">رقم الإصدار: ${Number(item.versionCode)}</p>
    <p class="content-text">${escapeHtml(String(item.releaseNotes || 'لا توجد ملاحظات إضافية.').slice(0, 600))}</p>
    <div class="release-actions"><a class="btn${item.isPrimary === true ? ' primary' : ''}" href="${escapeHtml(apkUrl(item.downloadUrl))}" rel="noopener noreferrer">تحميل APK — ${escapeHtml(item.versionName)}</a></div>
  </article>`).join('\n');
  const empty = unavailable
    ? '<section class="card notice" role="alert"><h2>تعذّر قراءة الإصدارات حاليًا</h2><p>أعد تحميل الصفحة بعد قليل. لا تحتاج إلى تغيير إعدادات جهازك.</p><a class="btn primary" href="/releases">إعادة المحاولة</a></section>'
    : '<section class="card"><p>لا توجد إصدارات متاحة للتحميل حاليًا.</p><a class="btn" href="/releases">تحديث الصفحة</a></section>';
  return `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07070d">
<title>BLOFY | مركز التحميل</title><link rel="stylesheet" href="/premium.css"><link rel="stylesheet" href="/release-manager.css">
</head><body data-page="downloads-static"><div class="wrap">
<header class="nav"><a class="brand" href="/"><img src="/blofy-logo.png" alt="">BLOFY PLAYER</a><nav class="nav-links" aria-label="روابط الموقع"><a href="/">الرئيسية</a><a href="/portal" class="btn">ربط جهازك</a></nav></header>
<main><div class="page-title"><span class="eyebrow">BLOFY DOWNLOADS</span><h1>جاهز لشاشتك.</h1>
<p>اختر الإصدار وحمّل ملف APK مباشرة. التحديث يحتفظ ببياناتك عند تطابق توقيع التطبيق.</p>
${primary ? `<div class="actions"><a id="download-primary" class="btn primary" href="/download/latest.apk">تحميل الإصدار الأساسي — ${escapeHtml(primary.versionName)}</a><a class="btn" href="/releases">تحديث الصفحة</a></div>` : ''}
<p class="caption">روابط التحميل تعمل بدون JavaScript، بما فيها متصفح Downloader.</p></div>
<div id="releases" class="two" data-server-rendered="true">${unavailable ? empty : cards || empty}</div>
<section class="section" aria-labelledby="install-title"><h2 id="install-title">التثبيت خطوة بخطوة</h2>
<nav class="actions" aria-label="تعليمات التثبيت"><a class="btn" href="#install-tv">تلفزيون / رسيفر</a><a class="btn" href="#install-phone">جوال / تابلت</a><a class="btn" href="#install-computer">كمبيوتر</a></nav>
<section id="install-tv" class="card section"><h3>تلفزيون / رسيفر</h3><ol><li>اضغط «تحميل APK» من هذه الصفحة داخل Downloader.</li><li>بعد اكتمال التنزيل، افتح الملف واختر تثبيت أو تحديث، واسمح بالتثبيت من مصدر التحميل عندما يطلب الجهاز ذلك.</li><li>للتحديث، ثبّت الملف فوق النسخة الحالية دون حذف التطبيق أو مسح بياناته.</li></ol></section>
<section id="install-phone" class="card section"><h3>جوال / تابلت أندرويد</h3><ol><li>حمّل ملف APK من الإصدار الذي تختاره أعلاه.</li><li>افتح الملف وامنح إذن التثبيت عند الطلب.</li><li>ثبّت التطبيق أو حدّث نسختك الحالية، ثم افتح BLOFY.</li></ol></section>
<section id="install-computer" class="card section"><h3>كمبيوتر</h3><p>هذه نسخة أندرويد APK وليست برنامج ويندوز. تشغيلها على الكمبيوتر يحتاج محاكي أندرويد.</p></section>
</section><div class="notice">تفعيل تطبيق BLOFY وصلاحية اشتراك البث منفصلان.</div></main>
<footer class="foot"><a href="/">BLOFY PLAYER</a><a href="/portal">إدارة جهازك</a></footer></div></body></html>`;
}

export async function servePublicDownloads(req, res, pathname, { list, onError = () => {}, timeoutMs = 8000 }) {
  if (!PATHS.has(pathname) || !['GET', 'HEAD'].includes(req.method)) return false;
  let items = [], unavailable = false, timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(list),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('release_list_timeout')), timeoutMs); })
    ]);
    if (!Array.isArray(result?.items)) throw new Error('invalid_release_list');
    items = result.items;
  } catch (error) {
    unavailable = true;
    try { onError(error); } catch { /* Observability must not prevent the error page. */ }
  } finally { clearTimeout(timer); }
  if (res.writableEnded || res.destroyed) return true;
  const body = renderPublicDownloads(items, { unavailable });
  res.writeHead(unavailable ? 503 : 200, {
    'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    ...(unavailable ? { 'retry-after': '15' } : {})
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
