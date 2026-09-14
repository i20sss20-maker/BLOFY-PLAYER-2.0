import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const APK_URL = 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.49/BLOFY-PLAYER-2.0-rc07.49-signed.apk';
const RELEASE = Object.freeze({
  versionCode: 2000060,
  versionName: '2.0.0-rc07.49',
  downloadUrl: APK_URL,
  releaseNotes: 'BLOFY PLAYER 49 — النسخة المستقرة المبنية على كود الإصدار 46 مع رفع رقم الإصدار فقط للتحديث فوق الإصدارات السابقة دون حذف بيانات العميل.',
  minSupportedVersionCode: 1
});

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
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function healthPayload() {
  return {
    ok: true,
    release: {
      service: 'blofy-update-distribution',
      version: '1.0.0',
      platform: 'railway',
      app: RELEASE
    },
    time: Date.now()
  };
}

function downloadPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#080812">
<title>BLOFY PLAYER | التحميل</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 70% 10%,#3e1672 0,#160b2b 30%,#080812 70%);color:#fff;display:grid;place-items:center;padding:24px}.card{width:min(680px,100%);background:rgba(18,15,30,.92);border:1px solid rgba(164,106,255,.25);border-radius:24px;padding:32px;box-shadow:0 28px 80px rgba(0,0,0,.42)}.brand{font-weight:800;letter-spacing:.08em;color:#caa7ff}.tag{display:inline-block;margin-top:12px;padding:7px 12px;border-radius:999px;background:#271841;color:#ddc8ff;font-size:13px}h1{font-size:clamp(30px,7vw,50px);margin:20px 0 10px}.lead{color:#cbc4d7;line-height:1.8}.btn{display:flex;justify-content:center;align-items:center;text-decoration:none;background:#7c3aed;color:white;font-weight:800;border-radius:15px;min-height:58px;padding:14px 22px;margin-top:25px}.meta{margin-top:18px;color:#92899f;font-size:14px;line-height:1.8}.note{margin-top:22px;padding:15px;border-radius:14px;background:#12101c;color:#bbb3c7;font-size:14px;line-height:1.7}</style>
</head>
<body><main class="card">
<div class="brand">BLOFY PLAYER</div><span class="tag">ANDROID · EXTERNAL RELEASE</span>
<h1>تحميل BLOFY PLAYER</h1>
<p class="lead">الإصدار الخارجي المستقر متاح للتلفزيون، الرسيفر، الجوال والتابلت بنظام أندرويد.</p>
<a class="btn" href="/download/latest.apk">تحميل الإصدار ${RELEASE.versionName}</a>
<div class="meta">Version Code: ${RELEASE.versionCode}<br>التثبيت فوق النسخة الحالية يحافظ على بيانات التطبيق عند توافق شهادة التوقيع.</div>
<div class="note">هذه صفحة توزيع النسخة الخارجية. نسخة Google Play تتلقى تحديثاتها من متجر Google Play.</div>
</main></body></html>`;
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      res.writeHead(405, { ...securityHeaders, allow: 'GET, HEAD', 'cache-control': 'no-store' });
      return res.end();
    }

    if (path === '/health' || path === '/release.json') {
      return sendJson(req, res, 200, healthPayload());
    }

    if (path === '/download/latest.apk') {
      res.writeHead(302, {
        ...securityHeaders,
        location: APK_URL,
        'cache-control': 'no-store, max-age=0'
      });
      return res.end();
    }

    if (['/', '/downloads', '/downloads/', '/releases', '/releases/'].includes(path)) {
      return sendHtml(req, res, 200, downloadPage());
    }

    return sendJson(req, res, 404, { ok: false, error: 'not_found' });
  } catch {
    return sendJson(req, res, 500, { ok: false, error: 'internal_error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLOFY update distribution listening on ${PORT}`);
});
