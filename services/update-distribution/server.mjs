import http from 'node:http';
import { initReleaseStore, getActiveRelease } from './release-store.mjs';
import { requireAdmin, sameOrigin, readForm, renderAdmin, handleAdminAction } from './admin-panel.mjs';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_ADMIN_PREFIX = `/${String(process.env.PUBLIC_ADMIN_PREFIX || '/admin').trim().replace(/^\/+|\/+$/g, '')}`;

const securityHeaders = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
});

function sendJson(req, res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...securityHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store, max-age=0'
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendHtml(req, res, status, body) {
  res.writeHead(status, {
    ...securityHeaders,
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store, max-age=0',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function redirect(res, location) {
  res.writeHead(303, { ...securityHeaders, location, 'cache-control': 'no-store, max-age=0' });
  res.end();
}

function publicRelease(release) {
  const { stage: _stage, ...safe } = release;
  return safe;
}

function healthPayload() {
  return {
    ok: true,
    release: {
      service: 'blofy-update-distribution',
      version: '3.0.0-azure',
      platform: 'azure-container-apps',
      app: publicRelease(getActiveRelease())
    },
    time: Date.now()
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function downloadPage(req) {
  const release = getActiveRelease();
  const rootUrl = publicBase(req);
  const directUrl = `${rootUrl}/download/latest.apk`;
  const notes = release.releaseNotes || 'إصدار BLOFY PLAYER المعتمد حاليًا.';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08070e"><meta name="description" content="مركز التحميل الرسمي لتطبيق BLOFY PLAYER"><title>BLOFY PLAYER | مركز التحميل الرسمي</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark;--bg:#08070e;--surface:rgba(20,16,31,.9);--surface2:rgba(30,23,45,.88);--line:rgba(191,151,255,.18);--text:#fff;--muted:#aaa3b6;--purple:#a579ff;--purple2:#7d46ff;--green:#78e6b0}*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{margin:0;min-height:100vh;color:var(--text);background:radial-gradient(circle at 82% -15%,rgba(126,54,232,.34),transparent 33rem),radial-gradient(circle at -8% 88%,rgba(45,75,210,.13),transparent 30rem),linear-gradient(145deg,#08070e,#0d0914 54%,#08070e);overflow-x:hidden}body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background-image:linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.012) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black,transparent 82%)}a{color:inherit}.shell{width:min(1120px,calc(100% - 38px));margin:auto}.topbar{height:88px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid rgba(255,255,255,.06)}.brand{display:flex;align-items:center;gap:12px;direction:ltr;font-weight:900;letter-spacing:.12em}.mark{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(145deg,#a777ff,#6037c7);box-shadow:0 12px 36px rgba(126,70,255,.3);font-size:18px}.brand-copy{display:grid;line-height:1.05}.brand-copy strong{font-size:14px}.brand-copy small{margin-top:6px;color:#8e81a3;font-size:9px;letter-spacing:.22em}.top-status{display:inline-flex;align-items:center;gap:8px;color:#c4bacf;font-size:12px}.top-status:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 16px rgba(120,230,176,.62)}.hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(330px,.85fr);gap:clamp(34px,7vw,88px);align-items:center;padding:74px 0 46px}.eyebrow{display:inline-flex;align-items:center;padding:8px 12px;border:1px solid rgba(181,139,255,.26);border-radius:999px;background:rgba(125,70,255,.08);color:#c9adff;font-size:11px;font-weight:900;letter-spacing:.12em;direction:ltr}.hero h1{margin:22px 0 18px;font-size:clamp(44px,6.7vw,78px);line-height:1.06;letter-spacing:-.045em}.hero h1 span{display:block;color:transparent;background:linear-gradient(180deg,#fff 10%,#fff 46%,#cfa8ff 66%,#9a5cff 100%);-webkit-background-clip:text;background-clip:text}.lead{max-width:650px;margin:0;color:#beb6c9;font-size:18px;line-height:1.95}.quick-points{display:flex;flex-wrap:wrap;gap:9px;margin-top:28px}.quick-points span{padding:8px 12px;border:1px solid rgba(255,255,255,.055);border-radius:999px;background:rgba(255,255,255,.025);color:#aaa1b6;font-size:12px}.release-card{position:relative;overflow:hidden;padding:28px;border:1px solid rgba(191,151,255,.24);border-radius:28px;background:linear-gradient(150deg,rgba(34,26,50,.94),rgba(12,10,18,.96));box-shadow:0 34px 100px rgba(0,0,0,.42);backdrop-filter:blur(18px)}.release-card:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,#c39cff,transparent)}.release-card:after{content:"";position:absolute;width:200px;height:200px;left:-90px;top:-90px;border-radius:50%;background:radial-gradient(circle,rgba(154,94,255,.18),transparent 68%);pointer-events:none}.release-state{display:flex;align-items:center;justify-content:space-between;gap:12px}.badge{display:inline-flex;padding:7px 11px;border:1px solid rgba(117,228,174,.22);border-radius:999px;background:rgba(59,171,116,.1);color:#8af0bc;font-size:11px;font-weight:900}.version{direction:ltr;unicode-bidi:isolate;display:inline-block}.release-card h2{margin:23px 0 5px;font-size:34px}.release-code{color:#857c91;font-size:12px}.download{display:flex;align-items:center;justify-content:center;min-height:62px;margin-top:25px;border-radius:17px;text-decoration:none;background:linear-gradient(115deg,#a77fff,#7446ef);box-shadow:0 15px 40px rgba(121,67,238,.27);font-size:17px;font-weight:900;transition:transform .18s ease,filter .18s ease}.download:hover{transform:translateY(-2px);filter:brightness(1.07)}.download:active{transform:scale(.985)}.direct{margin-top:15px;padding:13px;border:1px solid rgba(255,255,255,.06);border-radius:14px;background:rgba(4,3,7,.38)}.direct-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:#a69dad;font-size:11px}.direct-label strong{color:#d8c8ef}.url{direction:ltr;text-align:left;unicode-bidi:plaintext;word-break:break-all;color:#cdbce3;font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.section{padding:30px 0}.section-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:20px}.section-head h2{margin:7px 0 0;font-size:30px}.section-head p{margin:0;color:#8f879a;font-size:13px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.info{position:relative;overflow:hidden;min-height:172px;padding:22px;border:1px solid rgba(255,255,255,.065);border-radius:20px;background:linear-gradient(145deg,rgba(22,18,32,.8),rgba(11,9,16,.88))}.info:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(184,141,255,.23),transparent)}.icon{width:42px;height:42px;display:grid;place-items:center;margin-bottom:17px;border:1px solid rgba(177,131,245,.22);border-radius:13px;background:rgba(119,70,184,.12);color:#ceb1ff;font-weight:900}.info strong{display:block;margin-bottom:7px;font-size:16px}.muted{color:#9990a5;font-size:13px;line-height:1.75}.notes{margin:16px 0 44px;padding:24px;border:1px solid rgba(191,151,255,.14);border-radius:20px;background:rgba(18,14,27,.66);color:#bbb2c5;line-height:1.9}.notes strong{color:#e5d9f7}.foot{display:flex;justify-content:space-between;gap:18px;padding:28px 0 36px;border-top:1px solid rgba(255,255,255,.06);color:#71697c;font-size:11px;direction:ltr}@media(max-width:820px){.hero{grid-template-columns:1fr;padding-top:48px}.release-card{max-width:560px}.grid{grid-template-columns:1fr}.section-head{align-items:flex-start;flex-direction:column}.hero h1{font-size:clamp(42px,12vw,62px)}}@media(max-width:560px){.shell{width:min(100% - 24px,1120px)}.topbar{height:74px}.brand-copy small,.top-status{display:none}.hero{padding-top:36px;gap:28px}.lead{font-size:15px}.release-card{padding:22px;border-radius:22px}.release-card h2{font-size:29px}.section-head h2{font-size:25px}.foot{flex-direction:column;align-items:center}.quick-points{gap:7px}.quick-points span{font-size:11px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><div class="shell"><header class="topbar"><div class="brand"><div class="mark">B</div><span class="brand-copy"><strong>BLOFY PLAYER</strong><small>OFFICIAL RELEASES</small></span></div><div class="top-status">مركز التحميل متصل</div></header><main><section class="hero"><div><span class="eyebrow">BLOFY · OFFICIAL ANDROID RELEASE</span><h1>نسختك الرسمية.<span>جاهزة لشاشتك.</span></h1><p class="lead">حمّل أحدث إصدار عام من BLOFY PLAYER من المصدر الرسمي. الرابط المباشر ثابت، لذلك تقدر تحفظه في Downloader وتستخدمه لكل تحديث قادم.</p><div class="quick-points"><span>✓ Android TV & Box</span><span>✓ جوال وتابلت</span><span>✓ تحديث فوق النسخة الحالية</span></div></div><aside class="release-card"><div class="release-state"><span class="badge">PUBLIC · معتمد</span><span class="release-code">Version Code ${release.versionCode}</span></div><h2><span class="version">${escapeHtml(release.versionName)}</span></h2><div class="release-code">أحدث إصدار عام متاح الآن</div><a class="download" href="/download/latest.apk">تحميل APK الرسمي ↓</a><div class="direct"><div class="direct-label"><strong>رابط Downloader المباشر</strong><span>ثابت</span></div><div class="url">${escapeHtml(directUrl)}</div></div></aside></section><section class="section"><div class="section-head"><div><span class="eyebrow">QUICK INSTALL</span><h2>نزّله بالطريقة المناسبة لجهازك</h2></div><p>لا تحتاج تبحث عن رابط جديد عند كل إصدار.</p></div><div class="grid"><article class="info"><div class="icon">TV</div><strong>تلفزيون / Android Box</strong><div class="muted">افتح تطبيق Downloader واكتب الرابط المباشر أعلاه. بعد التحميل افتح APK وثبّت التحديث.</div></article><article class="info"><div class="icon">M</div><strong>جوال / تابلت</strong><div class="muted">اضغط زر التحميل، افتح الملف، واسمح بالتثبيت من المتصفح عند طلب أندرويد.</div></article><article class="info"><div class="icon">↻</div><strong>تحديث بدون فقد البيانات</strong><div class="muted">إذا كانت النسخة موقعة بنفس شهادة BLOFY، ثبتها فوق نسختك الحالية بدون حذف التطبيق.</div></article></div></section><section class="notes"><strong>ملاحظات الإصدار</strong><br>${escapeHtml(notes)}</section></main><footer class="foot"><span>BLOFY PLAYER · OFFICIAL DISTRIBUTION</span><span>Microsoft Azure</span></footer></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || '';

    if (pathname === '/admin' || pathname === '/admin/') {
      if (!['GET', 'HEAD'].includes(method)) {
        res.writeHead(405, { ...securityHeaders, allow: 'GET, HEAD', 'cache-control': 'no-store' });
        return res.end();
      }
      if (!requireAdmin(req, res, securityHeaders)) return;
      return sendHtml(req, res, 200, renderAdmin(String(url.searchParams.get('msg') || '').slice(0, 300)));
    }

    if (method === 'POST' && pathname.startsWith('/admin/')) {
      if (!requireAdmin(req, res, securityHeaders)) return;
      if (!sameOrigin(req)) return sendJson(req, res, 403, { ok: false, error: 'origin_rejected' });
      const form = await readForm(req);
      const message = await handleAdminAction(form, pathname);
      return redirect(res, `${PUBLIC_ADMIN_PREFIX}?msg=${encodeURIComponent(message)}`);
    }

    if (!['GET', 'HEAD'].includes(method)) {
      res.writeHead(405, { ...securityHeaders, allow: 'GET, HEAD, POST', 'cache-control': 'no-store' });
      return res.end();
    }

    if (pathname === '/health' || pathname === '/release.json') return sendJson(req, res, 200, healthPayload());

    if (pathname === '/download/latest.apk') {
      res.writeHead(302, {
        ...securityHeaders,
        location: getActiveRelease().downloadUrl,
        'cache-control': 'no-store, max-age=0'
      });
      return res.end();
    }

    if (['/', '/downloads', '/downloads/', '/releases', '/releases/'].includes(pathname)) {
      return sendHtml(req, res, 200, downloadPage(req));
    }

    return sendJson(req, res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('Request failed:', error?.message || error);
    if ((req.url || '').startsWith('/admin')) {
      return redirect(res, `${PUBLIC_ADMIN_PREFIX}?msg=${encodeURIComponent(`تعذر تنفيذ العملية: ${String(error?.message || 'internal_error').replaceAll('_', ' ')}`)}`);
    }
    return sendJson(req, res, 500, { ok: false, error: 'internal_error' });
  }
});

await initReleaseStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLOFY Azure update distribution listening on ${PORT}`);
});
