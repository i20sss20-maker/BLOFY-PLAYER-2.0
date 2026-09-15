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
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080812"><title>BLOFY PLAYER | التحميل</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 72% 5%,#4d1c86 0,#1a0c31 29%,#080812 68%);color:#fff;padding:22px}.wrap{width:min(840px,100%);margin:5vh auto}.card{background:rgba(16,13,27,.92);border:1px solid rgba(184,135,255,.24);border-radius:26px;padding:clamp(22px,5vw,38px);box-shadow:0 30px 90px rgba(0,0,0,.42)}.brand{font-weight:900;letter-spacing:.09em;color:#d2b4ff;font-size:14px}.badge{display:inline-flex;margin-top:16px;padding:7px 12px;border-radius:999px;background:#143829;color:#8bf0bc;font-weight:800;font-size:12px}.version{direction:ltr;unicode-bidi:isolate;display:inline-block}h1{font-size:clamp(34px,8vw,58px);line-height:1.05;margin:18px 0 12px}.lead{color:#cec6da;line-height:1.9;font-size:17px}.btn{display:flex;justify-content:center;align-items:center;text-decoration:none;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:white;font-weight:900;border-radius:16px;min-height:62px;padding:15px 22px;margin-top:24px;font-size:18px;box-shadow:0 13px 34px rgba(109,40,217,.26)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.info{background:#0c0a13;border:1px solid #2d243a;border-radius:15px;padding:16px}.info strong{display:block;color:#d7c4f7;margin-bottom:7px}.muted{color:#9e95aa;line-height:1.75;font-size:14px}.url{direction:ltr;text-align:left;unicode-bidi:plaintext;word-break:break-all;background:#09080d;border:1px dashed #514064;border-radius:12px;padding:12px;margin-top:9px;color:#cab8df;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.notes{margin-top:18px;padding-top:18px;border-top:1px solid #2b2236;color:#bdb4c9;line-height:1.8}.foot{text-align:center;color:#766e81;font-size:12px;margin-top:18px}@media(max-width:650px){body{padding:12px}.wrap{margin:2vh auto}.grid{grid-template-columns:1fr}.card{border-radius:20px}.lead{font-size:15px}}
</style></head><body><main class="wrap"><section class="card"><div class="brand">BLOFY PLAYER · AZURE OFFICIAL DOWNLOAD</div><span class="badge">PUBLIC · النسخة المعتمدة</span><h1>حمّل BLOFY PLAYER</h1><p class="lead">هذه صفحة الإصدارات الرسمية. ما يظهر هنا إلا الإصدار الذي اجتاز <strong>Draft → QA → Public</strong> وتم تعيينه كتحديث عام.</p><a class="btn" href="/download/latest.apk">تحميل <span class="version">${escapeHtml(release.versionName)}</span></a><div class="grid"><div class="info"><strong>الإصدار الحالي</strong><div class="muted"><span class="version">${escapeHtml(release.versionName)}</span><br>Version Code: ${release.versionCode}</div></div><div class="info"><strong>من تطبيق Downloader</strong><div class="muted">افتح هذا الرابط لتحميل آخر APK معتمد مباشرة:</div><div class="url">${escapeHtml(directUrl)}</div></div></div><div class="notes"><strong>ملاحظات الإصدار</strong><br>${escapeHtml(notes)}</div></section><div class="foot">BLOFY PLAYER · Microsoft Azure</div></main></body></html>`;
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
