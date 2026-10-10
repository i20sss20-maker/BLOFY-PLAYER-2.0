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
  const card = item => `<article class="card release-card${item.isPrimary === true ? ' release-primary' : ''}" data-version-code="${Number(item.versionCode)}">
    <div class="release-heading"><h2 dir="ltr">${escapeHtml(item.versionName)}</h2><span class="badge">${item.isPrimary === true ? '★ الإصدار الأساسي' : 'إصدار سابق'}</span></div>
    <p class="content-text">${escapeHtml(String(item.releaseNotes || 'لا توجد ملاحظات إضافية.').slice(0, 600))}</p>
    ${item.isPrimary === true ? `<details class="download-alternative"><summary>إذا لم يبدأ التنزيل</summary><a class="btn" href="${escapeHtml(apkUrl(item.downloadUrl))}" rel="noopener noreferrer">تحميل مباشر بديل</a><p>بعد التنزيل اختر «تثبيت» أو «تحديث». إذا طلب الجهاز الإذن، اسمح بالتثبيت من Downloader.</p></details>` : `<a class="btn" href="${escapeHtml(apkUrl(item.downloadUrl))}" rel="noopener noreferrer">تحميل ${escapeHtml(item.versionName)}</a>`}
  </article>`;
  const older = releases.filter(item => item !== primary);
  const cards = (primary ? card(primary) : '') + (older.length ? `<details class="previous-releases"><summary>الإصدارات السابقة <span>(${older.length})</span></summary><p class="caption">استخدمها فقط عند الحاجة. الإصدار الأساسي متاح من زر التنزيل بالأعلى.</p><div class="previous-list">${older.map(card).join('')}</div></details>` : '');
  const empty = unavailable
    ? '<section class="card notice" role="alert"><h2>تعذّر قراءة الإصدارات حاليًا</h2><p>أعد تحميل الصفحة بعد قليل. لا تحتاج إلى تغيير إعدادات جهازك.</p><a class="btn primary" href="/downloads">إعادة المحاولة</a></section>'
    : '<section class="card"><p>لا توجد إصدارات متاحة للتحميل حاليًا.</p><a class="btn" href="/downloads">تحديث الصفحة</a></section>';
  return `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07070d">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"BLOFY PLAYER","item":"https://blofyplayer.com/"},{"@type":"ListItem","position":2,"name":"التحميل","item":"https://blofyplayer.com/downloads"}]}</script>
<meta name="description" content="تحميل BLOFY PLAYER (بلوفي بلاير) لأجهزة أندرويد من Google Play أو APK. مشغل وسائط يدعم قوائم M3U وXtream Codes الخاصة بك، مع دليل التثبيت وربط الجهاز."><link rel="canonical" href="https://blofyplayer.com/downloads"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" href="/blofy-logo.png"><link rel="apple-touch-icon" href="/blofy-logo.png"><meta property="og:type" content="website"><meta property="og:site_name" content="BLOFY PLAYER"><meta property="og:title" content="تحميل BLOFY PLAYER (بلوفي بلاير) للأندرويد"><meta property="og:description" content="التحميل الرسمي من Google Play أو APK لأجهزة أندرويد، مع طريقة التثبيت والدعم وربط الجهاز."><meta property="og:url" content="https://blofyplayer.com/downloads"><meta property="og:image" content="https://blofyplayer.com/blofy-logo.png"><meta property="og:locale" content="ar_SA"><meta property="og:image:alt" content="شعار BLOFY PLAYER"><meta name="twitter:card" content="summary"><title>تحميل BLOFY PLAYER (بلوفي بلاير) لأندرويد | Google Play وAPK</title><link rel="stylesheet" href="/premium.css"><link rel="stylesheet" href="/release-manager.css"><link rel="stylesheet" href="/site-polish.css">
</head><body data-page="downloads-static"><div class="wrap">
<header class="nav"><a class="brand" href="/"><img src="/blofy-logo.png" alt="">BLOFY PLAYER</a><nav class="nav-links" aria-label="روابط الموقع"><a href="/">الرئيسية</a><a href="/guide">دليل التثبيت</a><a href="/support">الدعم والتجديد</a><a href="/connect">ربط جهازك</a><a href="/privacy">الخصوصية</a><a href="/status">حالة الخدمات</a><a href="https://wa.me/966568941484?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C%20%D8%A3%D8%AD%D8%AA%D8%A7%D8%AC%20%D8%AF%D8%B9%D9%85%20%D9%81%D9%86%D9%8A%20%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%20BLOFY%20PLAYER." rel="noopener noreferrer">الدعم</a><a class="btn primary" href="https://updates.blofyplayer.com" rel="noopener">آخر إصدار</a></nav></header>
<main class="download-page"><section class="download-hero" aria-labelledby="download-title"><span class="eyebrow">OFFICIAL DOWNLOAD CENTER</span>
<h1 id="download-title">تحميل BLOFY PLAYER (بلوفي بلاير) لأندرويد</h1><p class="download-intro">BLOFY PLAYER مشغل وسائط لأجهزة أندرويد، يدعم قوائم M3U وXtream Codes التي يضيفها المستخدم. حمّله رسميًا من Google Play، أو اختر ملف APK للتثبيت المباشر على أجهزة أندرويد المتوافقة.</p>
<div class="official-store-links"><a class="btn primary" id="google-play-primary" href="https://play.google.com/store/apps/details?id=tv.blofy.player.v2" rel="noopener noreferrer">التثبيت الرسمي من Google Play ↗</a><a class="btn" href="#versions-title">تحميل APK بديل</a><a class="btn" href="https://api.whatsapp.com/send?text=%D9%86%D8%B2%D9%91%D9%84%20BLOFY%20PLAYER%20%D9%84%D9%84%D8%A3%D9%86%D8%AF%D8%B1%D9%88%D9%8A%D8%AF%20%D9%85%D9%86%20%D8%A7%D9%84%D9%85%D9%88%D9%82%D8%B9%20%D8%A7%D9%84%D8%B1%D8%B3%D9%85%D9%8A%3A%20https%3A%2F%2Fblofyplayer.com%2Fdownloads%20%E2%80%94%20%D8%AF%D9%84%D9%8A%D9%84%20%D8%A7%D9%84%D8%AA%D8%AB%D8%A8%D9%8A%D8%AA%3A%20https%3A%2F%2Fblofyplayer.com%2Fguide%20.%20%D9%85%D8%B4%D8%BA%D9%91%D9%84%20%D9%88%D8%B3%D8%A7%D8%A6%D8%B7%20%D9%84%D9%82%D9%88%D8%A7%D8%A6%D9%85%D9%83%20%D8%A7%D9%84%D8%AE%D8%A7%D8%B5%D8%A9%20%D9%88%D9%84%D8%A7%20%D9%8A%D9%88%D9%81%D9%91%D8%B1%20%D8%A7%D8%B4%D8%AA%D8%B1%D8%A7%D9%83%20%D9%85%D8%AD%D8%AA%D9%88%D9%89." target="_blank" rel="noopener noreferrer" aria-label="مشاركة BLOFY PLAYER على واتساب">شارك BLOFY PLAYER ↗</a></div>
<div class="wa-contact-actions"><a class="wa-contact-support" href="https://wa.me/966568941484?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C%20%D8%A3%D8%AD%D8%AA%D8%A7%D8%AC%20%D8%AF%D8%B9%D9%85%20%D9%81%D9%86%D9%8A%20%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%20BLOFY%20PLAYER." rel="noopener noreferrer">💬 الدعم الفني عبر واتساب</a><a class="wa-contact-renew" href="https://wa.me/966568941484?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C%20%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%AA%D8%AC%D8%AF%D9%8A%D8%AF%20%D8%AA%D9%81%D8%B9%D9%8A%D9%84%20BLOFY%20PLAYER%20%D8%B9%D8%A8%D8%B1%20%D9%88%D8%A7%D8%AA%D8%B3%D8%A7%D8%A8.%20%D8%B1%D9%82%D9%85%20%D8%A7%D9%84%D8%AC%D9%87%D8%A7%D8%B2%3A%20" rel="noopener noreferrer">♻ تجديد التفعيل عبر واتساب</a></div>
<p class="wa-payment-note">التجديد حاليًا عبر واتساب حتى تتوفر بوابة الدفع الإلكتروني. يرجى إرسال رقم الجهاز، ولا ترسل رمز الربط.</p>
${primary && !unavailable ? `<a id="download-primary" class="btn download-main" href="/download/latest.apk"><span>تنزيل APK مباشر</span><span class="download-version" dir="ltr">${escapeHtml(primary.versionName)} · APK</span></a><p class="download-assurance">للتحديث: ثبّت فوق النسخة الحالية ولا تحذف التطبيق القديم.</p><p class="download-assurance">للـ Downloader استخدم الرابط السريع: <strong dir="ltr">blofyplayer.com/apk</strong></p>` : ''}
</section>
<section class="download-steps" aria-label="خطوات التثبيت"><article><strong>01</strong><div><h2>نزّل الإصدار</h2><p>التثبيت الموصى به من Google Play، أو استخدم رابط APK البديل عند الحاجة.</p></div></article><article><strong>02</strong><div><h2>ثبّت أو حدّث</h2><p>اسمح بالتثبيت من مصدر التنزيل عند الطلب.</p></div></article><article><strong>03</strong><div><h2>اربط جهازك</h2><p>افتح BLOFY ثم استخدم رقم الجهاز ورمز الربط.</p></div></article></section>
<section class="download-release-section" aria-labelledby="versions-title"><div class="download-section-head"><span class="eyebrow">AVAILABLE BUILDS</span><h2 id="versions-title">الإصدارات المتاحة</h2></div><div id="releases" data-server-rendered="true">${unavailable ? empty : cards || empty}</div></section>
<section class="section install-section" aria-labelledby="install-title"><div class="download-section-head"><span class="eyebrow">INSTALL GUIDE</span><h2 id="install-title">طريقة التثبيت حسب جهازك</h2></div>
<nav class="actions" aria-label="تعليمات التثبيت"><a class="btn" href="#install-tv">تلفزيون / رسيفر</a><a class="btn" href="#install-phone">جوال / تابلت</a><a class="btn" href="#install-computer">كمبيوتر</a></nav>
<section id="install-tv" class="card section"><h3>تلفزيون / رسيفر — Downloader</h3><ol><li>اضغط «تنزيل التطبيق الآن» وانتظر اكتمال التنزيل.</li><li>اختر «تثبيت» أو «تحديث»، واسمح بالتثبيت من Downloader عند الطلب.</li><li>افتح BLOFY PLAYER. لا تحذف التطبيق القديم عند التحديث.</li></ol></section>
<section id="install-phone" class="card section"><h3>جوال / تابلت أندرويد</h3><ol><li>افتح صفحة BLOFY PLAYER على Google Play واضغط «تثبيت». بديلًا عن ذلك يمكن تنزيل APK من الإصدارات أعلاه.</li><li>افتح الملف وامنح إذن التثبيت عند الطلب.</li><li>ثبّت التطبيق أو حدّث نسختك الحالية، ثم افتح BLOFY.</li></ol></section>
<section id="install-computer" class="card section"><h3>كمبيوتر</h3><p>هذه نسخة أندرويد APK وليست برنامج ويندوز. تشغيلها على الكمبيوتر يحتاج محاكي أندرويد.</p></section>
</section>
<section class="section install-section" id="faq" aria-labelledby="faq-title">
<p class="download-intro">تبي شرح مفصّل للتثبيت وربط الجهاز وإضافة القوائم؟ <a href="/guide">افتح دليل BLOFY PLAYER لأجهزة أندرويد والتلفزيون</a>.</p>
<div class="download-section-head"><span class="eyebrow">HELP & FAQ</span><h2 id="faq-title">أسئلة شائعة عن BLOFY PLAYER</h2></div>
<div class="card section">
<details><summary>كيف أحمل BLOFY PLAYER على التلفزيون أو الرسيفر؟</summary><p>على أجهزة Android TV والأجهزة المتوافقة، استخدم Google Play إن كان التطبيق متاحًا، أو افتح تطبيق Downloader واكتب <strong dir="ltr">blofyplayer.com/apk</strong> لتنزيل ملف APK الرسمي. لا تحذف النسخة المثبتة إذا كنت تحدّث التطبيق.</p></details>
<details><summary>هل يعمل BLOFY PLAYER على الجوال والتابلت؟</summary><p>توجد نسخة لأجهزة أندرويد المتوافقة. افتح رابط Google Play بالأعلى للتأكد من توفر التطبيق على جهازك، أو استخدم ملف APK عند الحاجة.</p></details>
<details><summary>كيف أربط الجهاز وأفعّل التطبيق؟</summary><p>افتح التطبيق لعرض معلومات الربط ثم انتقل إلى <a href="/connect">بوابة ربط الجهاز</a> واتبع التعليمات. لا تشارك رمز الربط المؤقت مع أشخاص غير موثوقين.</p></details>
<details><summary>كيف أجدد التفعيل أو أتواصل مع الدعم؟</summary><p>التجديد والدعم متاحان حاليًا عبر <a href="https://wa.me/966568941484" rel="noopener noreferrer">واتساب BLOFY PLAYER</a> ريثما تتوفر بوابة الدفع. اذكر رقم جهازك عند طلب التجديد ولا ترسل بيانات حساب قوائم التشغيل.</p></details>
<details><summary>هل يشمل تنزيل التطبيق قنوات أو اشتراك بث؟</summary><p>لا. BLOFY PLAYER تطبيق لتشغيل قوائم الوسائط التي يضيفها المستخدم ولديه حق الوصول إليها. تفعيل التطبيق لا يعني توفير اشتراك بث أو محتوى.</p></details>
</div></section>
<div class="notice">تفعيل تطبيق BLOFY وصلاحية اشتراك البث منفصلان.</div></main>
<footer class="foot"><a href="/">BLOFY PLAYER</a><a href="/downloads">التحميل</a><a href="/support">مركز الدعم</a><a href="/privacy">الخصوصية وحذف البيانات</a><a href="/connect">إدارة جهازك</a><a href="/status">حالة الخدمات</a><a href="https://wa.me/966568941484?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C%20%D8%A3%D8%AD%D8%AA%D8%A7%D8%AC%20%D8%AF%D8%B9%D9%85%20%D9%81%D9%86%D9%8A%20%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%20BLOFY%20PLAYER." rel="noopener noreferrer">الدعم</a><a href="https://wa.me/966568941484?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C%20%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%AA%D8%AC%D8%AF%D9%8A%D8%AF%20%D8%AA%D9%81%D8%B9%D9%8A%D9%84%20BLOFY%20PLAYER%20%D8%B9%D8%A8%D8%B1%20%D9%88%D8%A7%D8%AA%D8%B3%D8%A7%D8%A8.%20%D8%B1%D9%82%D9%85%20%D8%A7%D9%84%D8%AC%D9%87%D8%A7%D8%B2%3A%20" rel="noopener noreferrer">التجديد</a><a href="https://updates.blofyplayer.com" rel="noopener">مركز الإصدارات</a></footer></div></body></html>`;
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
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    ...(unavailable ? { 'retry-after': '15' } : {})
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
