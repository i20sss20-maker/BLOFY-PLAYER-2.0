import http from 'node:http';
import { initReleaseStore, getActiveRelease } from './release-store.mjs';
import { requireAdmin, sameOrigin, readForm, renderAdmin, handleAdminAction } from './admin-panel.mjs';
import { initAppLibrary, listApps, getApp } from './app-library.mjs';

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
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://raw.githubusercontent.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
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

function renderAppLibrary(apps) {
  if (!apps.length) return '';
  const rows = apps.map(app => `<article class="app-row${app.featured ? ' app-featured' : ''}">
    <div class="app-icon"><img src="${escapeHtml(app.iconUrl)}" alt="" loading="lazy"></div>
    <div class="app-copy">
      <div class="app-title-line"><h3>${escapeHtml(app.name)}</h3>${app.version ? `<span class="app-version">v${escapeHtml(app.version)}</span>` : ''}</div>
      <span class="device-tag">${escapeHtml(app.devices)}</span>
    </div>
    <a class="app-download" href="/download/apps/${encodeURIComponent(app.slug)}">تحميل APK ↓</a>
  </article>`).join('');
  return `<section class="apps-section">
    <div class="apps-head"><h2>تطبيقات للشاشات والرسيفرات</h2><span class="apps-count">${apps.length}</span></div>
    <div class="app-list">${rows}</div>
  </section>`;
}

async function downloadPage(req) {
  const release = getActiveRelease();
  const apps = await listApps();
  const rootUrl = publicBase(req);
  const directUrl = `${rootUrl}/download/latest.apk`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08070e"><meta name="description" content="مركز التحميل الرسمي لتطبيق BLOFY PLAYER"><title>BLOFY PLAYER | التحميل</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark;--bg:#08070e;--line:rgba(191,151,255,.16);--muted:#9f96aa;--green:#78e6b0;--purple:#8655f4}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;color:#fff;background:radial-gradient(circle at 85% -10%,rgba(126,54,232,.24),transparent 30rem),linear-gradient(145deg,#08070e,#0c0912 56%,#08070e)}a{color:inherit}.shell{width:min(1100px,calc(100% - 28px));margin:auto}.topbar{height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid rgba(255,255,255,.06)}.brand{display:flex;align-items:center;gap:10px;direction:ltr;font-weight:900;letter-spacing:.1em}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(145deg,#a777ff,#6037c7);font-size:17px;box-shadow:0 9px 28px rgba(126,70,255,.24)}.brand-copy{display:grid;line-height:1.02}.brand-copy strong{font-size:13px}.brand-copy small{margin-top:5px;color:#857a93;font-size:8px;letter-spacing:.18em}.top-status{display:inline-flex;align-items:center;gap:7px;color:#aaa1b6;font-size:11px}.top-status:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}main{padding:18px 0 30px}.official-card{display:grid;grid-template-columns:64px minmax(0,1fr) auto;align-items:center;gap:16px;padding:15px 17px;border:1px solid rgba(180,137,247,.25);border-radius:19px;background:linear-gradient(145deg,rgba(31,23,46,.92),rgba(12,10,17,.95));box-shadow:0 18px 55px rgba(0,0,0,.18)}.official-icon{width:60px;height:60px;display:grid;place-items:center;border-radius:16px;background:linear-gradient(145deg,#a777ff,#6037c7);font-size:26px;font-weight:1000;direction:ltr}.official-copy{min-width:0}.official-title{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.official-title h1{margin:0;font-size:23px;line-height:1}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;border:1px solid rgba(117,228,174,.22);background:rgba(59,171,116,.1);color:#8af0bc;font-size:10px;font-weight:900}.official-meta{margin-top:7px;color:#a89fb3;font-size:11px;direction:ltr;text-align:right}.direct-url{margin-top:6px;color:#786e83;font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;direction:ltr;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.official-download,.app-download{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:linear-gradient(115deg,#9e72ff,#7246e9);color:#fff;font-weight:900;white-space:nowrap}.official-download{min-width:170px;min-height:54px;padding:10px 18px;border-radius:14px;font-size:14px;box-shadow:0 12px 34px rgba(121,67,238,.2)}.apps-section{padding-top:18px}.apps-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.apps-head h2{margin:0;font-size:19px}.apps-count{display:grid;place-items:center;min-width:28px;height:28px;padding:0 8px;border-radius:999px;background:rgba(125,70,255,.1);border:1px solid rgba(181,139,255,.18);color:#cbb3f7;font-size:11px;font-weight:900}.app-list{display:flex;flex-direction:column;gap:8px}.app-row{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:13px;min-height:72px;padding:9px 11px;border:1px solid rgba(255,255,255,.06);border-radius:15px;background:rgba(16,13,23,.82)}.app-featured{border-color:rgba(167,127,255,.24)}.app-icon{width:50px;height:50px;display:grid;place-items:center;border-radius:12px;background:rgba(255,255,255,.035);overflow:hidden}.app-icon img{width:43px;height:43px;object-fit:contain;border-radius:9px}.app-copy{min-width:0}.app-title-line{display:flex;align-items:center;gap:8px;min-width:0}.app-title-line h3{margin:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.app-version{direction:ltr;color:#83798e;font-size:9px;white-space:nowrap}.device-tag{display:block;margin-top:5px;color:#7d7388;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.app-download{min-width:118px;min-height:44px;padding:8px 12px;border-radius:12px;font-size:11px}.official-download:hover,.app-download:hover{filter:brightness(1.08)}.official-download:focus,.app-download:focus{outline:3px solid #fff;outline-offset:3px;box-shadow:0 0 0 6px rgba(126,70,255,.65)}.foot{padding:22px 0 26px;color:#625b6b;font-size:10px;text-align:center}
@media(max-width:620px){.shell{width:min(100% - 18px,1100px)}.topbar{height:58px}.brand-copy small,.top-status{display:none}main{padding-top:10px}.official-card{grid-template-columns:48px minmax(0,1fr);gap:10px;padding:10px}.official-icon{width:46px;height:46px;border-radius:12px;font-size:20px}.official-title h1{font-size:17px}.official-meta{font-size:9px}.direct-url{display:none}.official-download{grid-column:1/-1;width:100%;min-height:46px}.apps-section{padding-top:14px}.apps-head h2{font-size:16px}.app-row{grid-template-columns:44px minmax(0,1fr) auto;gap:9px;min-height:62px;padding:8px}.app-icon{width:42px;height:42px}.app-icon img{width:36px;height:36px}.app-title-line h3{font-size:13px}.device-tag{font-size:8px}.app-download{min-width:94px;min-height:40px;padding:7px 9px;font-size:10px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><div class="shell"><header class="topbar"><div class="brand"><div class="mark">B</div><span class="brand-copy"><strong>BLOFY PLAYER</strong><small>DOWNLOAD CENTER</small></span></div><div class="top-status">مركز التحميل متصل</div></header><main><section class="official-card"><div class="official-icon">B</div><div class="official-copy"><div class="official-title"><h1>BLOFY PLAYER</h1><span class="badge">معتمد</span></div><div class="official-meta">${escapeHtml(release.versionName)} · Version Code ${release.versionCode}</div><div class="direct-url">${escapeHtml(directUrl)}</div></div><a class="official-download" href="/download/latest.apk">تحميل BLOFY APK ↓</a></section>${renderAppLibrary(apps)}</main><footer class="foot">BLOFY PLAYER · Microsoft Azure</footer></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || '';

    if (pathname === '/admin' || pathname === '/admin/' || pathname === PUBLIC_ADMIN_PREFIX || pathname === `${PUBLIC_ADMIN_PREFIX}/`) {
      if (!['GET', 'HEAD'].includes(method)) {
        res.writeHead(405, { ...securityHeaders, allow: 'GET, HEAD', 'cache-control': 'no-store' });
        return res.end();
      }
      if (!requireAdmin(req, res, securityHeaders)) return;
      return sendHtml(req, res, 200, await renderAdmin(String(url.searchParams.get('msg') || '').slice(0, 300)));
    }

    if (method === 'POST' && (pathname.startsWith('/admin/') || pathname.startsWith(`${PUBLIC_ADMIN_PREFIX}/`))) {
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

    const appMatch = pathname.match(/^\/(?:apps|download\/apps)\/([a-z0-9-]+)$/i);
    if (appMatch) {
      const app = await getApp(decodeURIComponent(appMatch[1]));
      if (!app) return sendJson(req, res, 404, { ok: false, error: 'app_not_found' });
      res.writeHead(302, {
        ...securityHeaders,
        location: app.downloadUrl,
        'cache-control': 'no-store, max-age=0'
      });
      return res.end();
    }

    if (['/', '/downloads', '/downloads/', '/releases', '/releases/'].includes(pathname)) {
      return sendHtml(req, res, 200, await downloadPage(req));
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

await Promise.all([initReleaseStore(), initAppLibrary()]);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLOFY Azure update distribution listening on ${PORT}`);
});
