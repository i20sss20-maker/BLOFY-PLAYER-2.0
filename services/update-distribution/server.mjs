import http from 'node:http';
import { Readable } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { initReleaseStore, getActiveRelease } from './release-store.mjs';
import { requireAdmin, sameOrigin, readForm, renderAdmin, handleAdminAction } from './admin-panel.mjs';
import { initAppLibrary, listApps, getApp, listAppVariants, getAppVariant, refreshManagedApps, refreshAppHealth, recordDownload, openRemoteApk } from './app-library.mjs';
import { observeDownloadCompletion } from './download-metrics.mjs';
import { recordDownloadCompletion } from './app-library.mjs';

const PORT = Number(process.env.PORT || 3000);
const APP_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PUBLIC_ADMIN_PREFIX = `/${String(process.env.PUBLIC_ADMIN_PREFIX || '/admin').trim().replace(/^\/+|\/+$/g, '')}`;
const RELEASE_UPLOAD_TOKEN = String(process.env.RELEASE_UPLOAD_TOKEN || '');
const LOCAL_RELEASE_DIR = '/data/releases';
const RELEASE_ARTIFACT_ZIP_URL = String(process.env.BLOFY_RELEASE_ARTIFACT_ZIP_URL || '').trim();
const RELEASE_ARTIFACT_ENTRY = String(process.env.BLOFY_RELEASE_ARTIFACT_ENTRY || '').trim();
const RELEASE_ARTIFACT_SHA256 = String(process.env.BLOFY_RELEASE_APK_SHA256 || '').trim().toLowerCase();
const QA_APK_URL = String(process.env.BLOFY_QA_APK_URL || 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/qa-20260926-stability/BLOFY-PLAYER-2.0-rc06-QA-PRODUCTION-SIGNED.apk').trim();

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
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https://raw.githubusercontent.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function redirect(res, location) {
  res.writeHead(303, { ...securityHeaders, location, 'cache-control': 'no-store, max-age=0' });
  res.end();
}

function safeApkFilename(value) {
  const base = String(value || 'app').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'app';
  return base.toLowerCase().endsWith('.apk') ? base : `${base}.apk`;
}

function localReleaseFilename(value) {
  const name = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]*\.apk$/i.test(name)) throw new Error('invalid_release_filename');
  return name;
}

function localReleasePath(filename) {
  return path.join(LOCAL_RELEASE_DIR, localReleaseFilename(filename));
}

function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function streamLocalApk(req, res, filename, downloadName, metricKey) {
  const filePath = localReleasePath(filename);
  const info = await stat(filePath);
  const total = info.size;
  const rawRange = String(req.headers.range || '').trim();
  let start = 0;
  let end = total - 1;
  let status = 200;
  if (rawRange) {
    const match = rawRange.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.writeHead(416, { ...securityHeaders, 'content-range': `bytes */${total}` });
      return res.end();
    }
    if (match[1]) start = Number(match[1]);
    if (match[2]) end = Number(match[2]);
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, total - suffix);
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
      res.writeHead(416, { ...securityHeaders, 'content-range': `bytes */${total}` });
      return res.end();
    }
    end = Math.min(end, total - 1);
    status = 206;
  }
  const length = end - start + 1;
  const headers = {
    ...securityHeaders,
    'content-type': 'application/vnd.android.package-archive',
    'content-disposition': `attachment; filename="${safeApkFilename(downloadName)}"`,
    'content-length': String(length),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=300'
  };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${total}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const body = createReadStream(filePath, { start, end });
  observeDownloadCompletion({ req, res, body, status, length: String(length), contentRange: headers['content-range'] || '',
    onComplete: () => recordDownloadCompletion(metricKey),
    onError: error => console.error('Local APK completion metric failed:', error?.message || error) });
  res.once('close', () => { if (!res.writableFinished) body.destroy(); });
  body.pipe(res);
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
    input.on('error', reject);
  });
}

async function importReleaseArtifactIfConfigured() {
  if (!RELEASE_ARTIFACT_ZIP_URL || !RELEASE_ARTIFACT_ENTRY || !RELEASE_ARTIFACT_SHA256) return;
  const filename = localReleaseFilename(path.basename(RELEASE_ARTIFACT_ENTRY));
  const finalPath = localReleasePath(filename);
  const existing = await stat(finalPath).catch(() => null);
  if (existing?.size > 1024) {
    const digest = await sha256File(finalPath).catch(() => '');
    if (digest === RELEASE_ARTIFACT_SHA256) {
      console.log(`release artifact ready: ${filename} (${existing.size} bytes)`);
      return;
    }
  }

  const archivePath = '/tmp/blofy-release-artifact.zip';
  await unlink(archivePath).catch(() => {});
  await mkdir(LOCAL_RELEASE_DIR, { recursive: true });

  const response = await fetch(RELEASE_ARTIFACT_ZIP_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { accept: 'application/zip' }
  });
  if (!response.ok || !response.body) throw new Error(`release_artifact_http_${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > 512 * 1024 * 1024) throw new Error('release_artifact_too_large');

  const archiveOut = createWriteStream(archivePath, { flags: 'wx' });
  await new Promise((resolve, reject) => {
    Readable.fromWeb(response.body).pipe(archiveOut);
    archiveOut.on('finish', resolve);
    archiveOut.on('error', reject);
  });

  const tempPath = finalPath + '.part';
  await unlink(tempPath).catch(() => {});
  await new Promise((resolve, reject) => {
    const unzip = spawn('unzip', ['-p', archivePath, RELEASE_ARTIFACT_ENTRY], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(tempPath, { flags: 'wx' });
    let stderr = '';
    unzip.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 512); });
    unzip.stdout.pipe(out);
    unzip.on('error', reject);
    unzip.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`release_unzip_failed_${code}:${stderr.slice(0,120)}`));
    });
    out.on('error', reject);
  });
  await rename(tempPath, finalPath);
  const digest = await sha256File(finalPath);
  if (digest !== RELEASE_ARTIFACT_SHA256) {
    await unlink(finalPath).catch(() => {});
    throw new Error('release_artifact_sha256_mismatch');
  }
  const info = await stat(finalPath);
  console.log(`release artifact imported: ${filename} (${info.size} bytes)`);
  await unlink(archivePath).catch(() => {});
}

async function receiveReleaseUpload(req, res, requestUrl) {
  if (!RELEASE_UPLOAD_TOKEN) return sendJson(req, res, 503, { ok: false, error: 'release_upload_disabled' });
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || !constantTimeEqual(auth.slice(7), RELEASE_UPLOAD_TOKEN)) {
    return sendJson(req, res, 401, { ok: false, error: 'unauthorized' });
  }
  const filename = localReleaseFilename(requestUrl.searchParams.get('filename'));
  const length = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(length) || length < 1024 || length > 320 * 1024 * 1024) {
    return sendJson(req, res, 413, { ok: false, error: 'invalid_release_size' });
  }
  await mkdir(LOCAL_RELEASE_DIR, { recursive: true });
  const finalPath = localReleasePath(filename);
  const tempPath = finalPath + '.part';
  await unlink(tempPath).catch(() => {});
  await new Promise((resolve, reject) => {
    const out = createWriteStream(tempPath, { flags: 'wx' });
    let received = 0;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > 320 * 1024 * 1024) req.destroy(new Error('release_too_large'));
    });
    req.pipe(out);
    out.on('finish', () => received === length ? resolve() : reject(new Error('release_size_mismatch')));
    out.on('error', reject);
    req.on('error', reject);
  });
  await rename(tempPath, finalPath);
  const info = await stat(finalPath);
  return sendJson(req, res, 201, { ok: true, filename, size: info.size });
}

async function streamApkDownload(req, res, sourceUrl, filename, metricKey) {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol === 'https:' &&
        parsed.hostname === 'updates.blofyplayer.com' &&
        parsed.pathname.startsWith('/files/releases/')) {
      return await streamLocalApk(req, res, decodeURIComponent(parsed.pathname.split('/').pop() || ''), filename, metricKey);
    }
  } catch {}
  const rawRange = String(req.headers.range || '').trim();
  const range = /^bytes=\d*-\d*$/.test(rawRange) ? rawRange : '';
  const opened = await openRemoteApk(sourceUrl, { method: req.method, range });
  const upstream = opened.response;
  const status = upstream.status === 206 ? 206 : 200;
  const headers = {
    ...securityHeaders,
    'content-type': 'application/vnd.android.package-archive',
    'content-disposition': `attachment; filename="${safeApkFilename(filename)}"`,
    'cache-control': 'no-store, max-age=0',
    'accept-ranges': 'bytes'
  };

  const length = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const etag = upstream.headers.get('etag');
  const lastModified = upstream.headers.get('last-modified');
  if (length) headers['content-length'] = length;
  if (contentRange) headers['content-range'] = contentRange;
  if (etag) headers.etag = etag;
  if (lastModified) headers['last-modified'] = lastModified;

  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    try { await upstream.body?.cancel(); } catch {}
    return res.end();
  }
  if (!upstream.body) return res.end();

  const body = Readable.fromWeb(upstream.body);
  observeDownloadCompletion({ req, res, body, status, length, contentRange,
    onComplete: () => recordDownloadCompletion(metricKey),
    onError: error => console.error('APK completion metric failed:', error?.message || error) });
  res.once('close', () => { if (!res.writableFinished) body.destroy(); });
  body.on('error', error => {
    console.error('APK proxy stream failed:', error?.message || error);
    if (!res.destroyed) res.destroy(error);
  });
  body.pipe(res);
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

function formatApkSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  const mb = value / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
}

function appFreshnessBadge(app) {
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  if (app.createdAt && now - app.createdAt >= 0 && now - app.createdAt < windowMs) {
    return '<span class="mini-badge badge-new">جديد</span>';
  }
  if (app.versionUpdatedAt && now - app.versionUpdatedAt >= 0 && now - app.versionUpdatedAt < windowMs) {
    return '<span class="mini-badge badge-updated">محدث</span>';
  }
  return '';
}

function formatPublicDate(ms) {
  if (!ms) return '';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

function downloadCategoryLabel(category) {
  return ({
    media:'مشغلات',
    files:'ملفات',
    downloads:'تنزيل ومتصفحات',
    launcher:'واجهات',
    screensaver:'شاشة توقف',
    tools:'أدوات',
    network:'شبكة',
    store:'متاجر'
  })[category] || category;
}

function renderAppLibrary(apps, variants = [], rootUrl = '') {
  if (!apps.length) return '';
  const variantsBySlug = new Map();
  for (const variant of variants) {
    if (!variantsBySlug.has(variant.slug)) variantsBySlug.set(variant.slug, []);
    variantsBySlug.get(variant.slug).push(variant);
  }
  const filterDefs = [
    ['all','الكل'], ['tv','TV'], ['media','مشغلات'], ['files','ملفات'],
    ['downloads','تنزيل'], ['tools','أدوات'], ['network','شبكة'], ['store','متاجر'],
    ['launcher','واجهات'], ['screensaver','شاشة توقف']
  ];
  const categories = new Set(apps.map(app => app.category));
  const filterButtons = filterDefs
    .filter(([key]) => key === 'all' || key === 'tv' || categories.has(key))
    .map(([key,label], index) => `<button class="filter-chip${index === 0 ? ' active' : ''}" type="button" data-filter="${key}">${label}</button>`)
    .join('');

  const rows = apps.map(app => {
    const meta = [app.architecture, formatApkSize(app.apkSizeBytes), app.devices].filter(Boolean).join(' · ');
    const searchText = [app.name, app.description, app.devices, app.architecture, app.version, downloadCategoryLabel(app.category)].filter(Boolean).join(' ');
    const isTv = /(?:android tv|google tv|fire tv|\btv\b)/i.test(String(app.devices || ''));
    const detailsId = `details-${app.slug}`;
    const updated = formatPublicDate(app.versionUpdatedAt || app.updatedAt);
    const appVariants = variantsBySlug.get(app.slug) || [];
    const stableDownloadUrl = `${String(rootUrl || '').replace(/\/$/, '')}/d/${encodeURIComponent(app.slug)}`;
    const variantButtons = appVariants.length > 1
      ? `<div class="variant-options"><strong>نسخ التحميل</strong>${appVariants.map(variant => {
          const size = formatApkSize(variant.apkSizeBytes);
          return `<a class="variant-link" href="/d/${encodeURIComponent(app.slug)}/${encodeURIComponent(variant.key)}">${escapeHtml(variant.label)}${size ? ` · ${escapeHtml(size)}` : ''}</a>`;
        }).join('')}<div class="variant-guide">إذا ما تعرف نوع جهازك اختر Universal إن كانت موجودة؛ الأجهزة القديمة غالبًا ARMv7، والجديدة غالبًا ARM64.</div></div>`
      : '';
    return `<article id="app-${escapeHtml(app.slug)}" class="app-row${app.featured ? ' app-featured' : ''}" data-app-row data-slug="${escapeHtml(app.slug)}" data-category="${escapeHtml(app.category)}" data-tv="${isTv ? '1' : '0'}" data-variants="${appVariants.length}" data-search="${escapeHtml(searchText)}">
      <div class="app-icon" data-symbol="${escapeHtml(app.symbol)}"><img src="${escapeHtml(app.iconUrl)}" alt="" loading="lazy"><span class="icon-fallback">${escapeHtml(app.symbol)}</span></div>
      <div class="app-copy">
        <div class="app-title-line"><h3>${escapeHtml(app.name)}</h3>${app.version ? `<span class="app-version">v${escapeHtml(app.version)}</span>` : ''}${app.featured ? '<span class="mini-badge">موصى به</span>' : ''}${appFreshnessBadge(app)}</div>
        <p class="app-desc">${escapeHtml(app.description)}</p>
        <span class="device-tag">${escapeHtml(meta)}</span>
      </div>
      <div class="app-actions">
        <a class="app-download" href="/download/apps/${encodeURIComponent(app.slug)}">تحميل APK ↓</a>
        <button class="app-more" type="button" data-details-toggle data-default-label="${appVariants.length > 1 ? 'نسخ / تفاصيل' : 'تفاصيل'}" aria-expanded="false" aria-controls="${detailsId}">${appVariants.length > 1 ? 'نسخ / تفاصيل' : 'تفاصيل'}</button>
      </div>
      <div class="app-details" id="${detailsId}" hidden>
        <span><b>القسم</b>${escapeHtml(downloadCategoryLabel(app.category))}</span>
        ${app.version ? `<span><b>الإصدار</b>${escapeHtml(app.version)}</span>` : ''}
        <span><b>المعمارية</b>${escapeHtml(app.architecture || 'Universal')}</span>
        ${app.apkSizeBytes ? `<span><b>الحجم</b>${escapeHtml(formatApkSize(app.apkSizeBytes))}</span>` : ''}
        <span><b>الأجهزة</b>${escapeHtml(app.devices)}</span>
        ${updated ? `<span><b>آخر تحديث</b>${escapeHtml(updated)}</span>` : ''}
        <div class="stable-download-link"><strong>رابط مباشر للـ Downloader</strong><a href="${escapeHtml(stableDownloadUrl)}">${escapeHtml(stableDownloadUrl)}</a><button class="copy-link" type="button" data-copy-url="${escapeHtml(stableDownloadUrl)}">نسخ الرابط</button></div>
        ${variantButtons}
      </div>
    </article>`;
  }).join('');

  return `<section class="apps-section">
    <div class="apps-head"><h2>تطبيقات للشاشات والرسيفرات</h2><span class="apps-count" id="visible-count">${apps.length}</span></div>
    <div class="app-controls">
      <label class="search-box" for="app-search"><span>⌕</span><input id="app-search" type="search" placeholder="ابحث عن تطبيق..." autocomplete="off" spellcheck="false"><button class="search-clear" id="search-clear" type="button" aria-label="مسح البحث" hidden>×</button></label>
      <div class="filter-bar" aria-label="تصنيف التطبيقات">${filterButtons}</div>
    </div>
    <div class="app-list">${rows}</div>
    <div class="empty-state" id="empty-state" hidden>ما لقينا تطبيق مطابق للبحث.</div>
  </section>`;
}

async function downloadPage(req) {
  const release = getActiveRelease();
  const [apps, variants] = await Promise.all([listApps(), listAppVariants()]);
  const rootUrl = publicBase(req);
  const directUrl = `${rootUrl}/d/blofy`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08070e"><meta name="description" content="مركز التحميل الرسمي لتطبيق BLOFY PLAYER"><title>BLOFY PLAYER | التحميل</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark;--bg:#08070e;--line:rgba(191,151,255,.16);--muted:#9f96aa;--green:#78e6b0;--purple:#8655f4}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;color:#fff;background:radial-gradient(circle at 85% -10%,rgba(126,54,232,.24),transparent 30rem),linear-gradient(145deg,#08070e,#0c0912 56%,#08070e)}a{color:inherit}.shell{width:min(1100px,calc(100% - 28px));margin:auto}.topbar{height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid rgba(255,255,255,.06)}.brand{display:flex;align-items:center;gap:10px;direction:ltr;font-weight:900;letter-spacing:.1em}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:rgba(255,255,255,.04);overflow:hidden;box-shadow:0 9px 28px rgba(126,70,255,.18)}.mark img{width:34px;height:34px;object-fit:contain}.brand-copy{display:grid;line-height:1.02}.brand-copy strong{font-size:13px}.brand-copy small{margin-top:5px;color:#857a93;font-size:8px;letter-spacing:.18em}.top-status{display:inline-flex;align-items:center;gap:7px;color:#aaa1b6;font-size:11px}.top-status:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}main{padding:18px 0 30px}.official-card{display:grid;grid-template-columns:64px minmax(0,1fr) auto;align-items:center;gap:16px;padding:15px 17px;border:1px solid rgba(180,137,247,.25);border-radius:19px;background:linear-gradient(145deg,rgba(31,23,46,.92),rgba(12,10,17,.95));box-shadow:0 18px 55px rgba(0,0,0,.18)}.official-icon{width:60px;height:60px;display:grid;place-items:center;border-radius:16px;background:rgba(255,255,255,.035);overflow:hidden}.official-icon img{width:54px;height:54px;object-fit:contain}.official-copy{min-width:0}.official-title{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.official-title h1{margin:0;font-size:23px;line-height:1}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;border:1px solid rgba(117,228,174,.22);background:rgba(59,171,116,.1);color:#8af0bc;font-size:10px;font-weight:900}.official-desc{margin-top:6px;color:#9b92a6;font-size:10px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.official-meta{margin-top:6px;color:#a89fb3;font-size:11px;direction:ltr;text-align:right}.direct-url{margin-top:6px;color:#786e83;font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;direction:ltr;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.official-download,.app-download{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:linear-gradient(115deg,#9e72ff,#7246e9);color:#fff;font-weight:900;white-space:nowrap}.official-download{min-width:170px;min-height:54px;padding:10px 18px;border-radius:14px;font-size:14px;box-shadow:0 12px 34px rgba(121,67,238,.2)}.apps-section{padding-top:18px}.apps-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.apps-head h2{margin:0;font-size:19px}.apps-count{display:grid;place-items:center;min-width:28px;height:28px;padding:0 8px;border-radius:999px;background:rgba(125,70,255,.1);border:1px solid rgba(181,139,255,.18);color:#cbb3f7;font-size:11px;font-weight:900}.app-controls{display:flex;align-items:center;gap:9px;margin-bottom:10px;flex-wrap:wrap}.search-box{height:40px;min-width:220px;flex:1 1 270px;display:flex;align-items:center;gap:8px;padding:0 11px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(14,11,20,.88);color:#776d83}.search-box:focus-within{border-color:rgba(167,127,255,.55);box-shadow:0 0 0 3px rgba(126,70,255,.12)}.search-box input{width:100%;border:0;outline:0;background:transparent;color:#fff;font:inherit;font-size:11px}.search-box input::placeholder{color:#72687d}.search-clear{width:26px;height:26px;display:grid;place-items:center;flex:0 0 26px;padding:0;border:0;border-radius:8px;background:rgba(255,255,255,.05);color:#a99eb5;font:700 17px/1 system-ui;cursor:pointer}.search-clear:hover{background:rgba(255,255,255,.09);color:#fff}.filter-bar{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;max-width:100%;padding:2px}.filter-bar::-webkit-scrollbar{display:none}.filter-chip{min-height:36px;padding:7px 11px;border-radius:11px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.025);color:#958b9f;font:inherit;font-size:10px;font-weight:800;white-space:nowrap;cursor:pointer}.filter-chip.active{background:rgba(129,75,228,.17);border-color:rgba(167,127,255,.3);color:#d9c5ff}.filter-chip:focus,.search-box input:focus{outline:none}.filter-chip:focus-visible{outline:3px solid #fff;outline-offset:2px}.app-list{display:flex;flex-direction:column;gap:8px}.app-row{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:13px;min-height:72px;padding:9px 11px;border:1px solid rgba(255,255,255,.06);border-radius:15px;background:rgba(16,13,23,.82)}.app-row[hidden]{display:none!important}.app-featured{border-color:rgba(167,127,255,.24)}.app-row.app-target{border-color:rgba(167,127,255,.52);box-shadow:0 0 0 2px rgba(126,70,255,.18),0 16px 36px rgba(0,0,0,.18)}.app-icon{width:50px;height:50px;display:grid;place-items:center;border-radius:12px;background:rgba(255,255,255,.035);overflow:hidden;color:#cdb6ef;font-size:10px;font-weight:900;direction:ltr}.app-icon img{grid-area:1/1;width:43px;height:43px;object-fit:contain;border-radius:9px}.icon-fallback{grid-area:1/1;display:none}.app-icon.icon-error img{display:none}.app-icon.icon-error .icon-fallback{display:block}.app-copy{min-width:0}.app-title-line{display:flex;align-items:center;gap:7px;min-width:0}.app-title-line h3{margin:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.app-version{direction:ltr;color:#83798e;font-size:9px;white-space:nowrap}.mini-badge{padding:3px 6px;border-radius:999px;border:1px solid rgba(165,124,255,.2);background:rgba(126,70,255,.1);color:#bea3ef;font-size:8px;font-weight:900;white-space:nowrap}.badge-new{color:#9af0c5;border-color:rgba(90,220,150,.2);background:rgba(39,143,92,.11)}.badge-updated{color:#f0d59a;border-color:rgba(230,185,95,.2);background:rgba(150,110,35,.12)}.app-desc{margin:4px 0 0;color:#9b92a6;font-size:10px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.device-tag{display:block;margin-top:4px;color:#7d7388;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;text-align:right}.app-actions{display:grid;gap:5px;min-width:118px}.app-download{min-width:118px;min-height:40px;padding:7px 12px;border-radius:12px;font-size:11px}.app-more{min-height:28px;padding:4px 9px;border-radius:9px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.025);color:#9d93a8;font:800 9px/1 system-ui;cursor:pointer}.app-more:hover{color:#fff;border-color:rgba(167,127,255,.28)}.app-details{grid-column:2/-1;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid rgba(255,255,255,.05);color:#8f859a;font-size:9px}.app-details[hidden]{display:none}.app-details span{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border-radius:8px;background:rgba(255,255,255,.025)}.app-details b{color:#c4b8d0;font-size:8px}.stable-download-link{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;background:rgba(126,70,255,.055);border:1px solid rgba(167,127,255,.12)}.stable-download-link strong{color:#c4b8d0;font-size:8px;white-space:nowrap}.stable-download-link a{min-width:0;direction:ltr;text-align:left;color:#bfa7ef;text-decoration:none;font:8px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stable-download-link a:hover{color:#fff;text-decoration:underline}.stable-download-link a:focus{outline:3px solid #fff;outline-offset:2px}.copy-link{min-height:27px;padding:4px 8px;border-radius:8px;border:1px solid rgba(167,127,255,.18);background:rgba(126,70,255,.1);color:#d7c6f6;font:800 8px/1 system-ui;white-space:nowrap;cursor:pointer}.copy-link:hover{color:#fff;border-color:rgba(167,127,255,.36)}.copy-link:focus{outline:3px solid #fff;outline-offset:2px}.variant-options{width:100%;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px}.variant-options strong{color:#c4b8d0;font-size:9px;margin-inline-end:2px}.variant-guide{width:100%;color:#766c82;font-size:8px;line-height:1.45;margin-top:1px}.variant-link{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:5px 8px;border-radius:9px;border:1px solid rgba(167,127,255,.16);background:rgba(126,70,255,.07);color:#cdb7f4;text-decoration:none;font-size:8px;font-weight:900;white-space:nowrap}.variant-link:hover{border-color:rgba(167,127,255,.35);color:#fff}.variant-link:focus{outline:3px solid #fff;outline-offset:2px}.official-download:hover,.app-download:hover{filter:brightness(1.08)}.official-download:focus,.app-download:focus,.app-more:focus{outline:3px solid #fff;outline-offset:3px;box-shadow:0 0 0 6px rgba(126,70,255,.65)}.empty-state{padding:22px 10px;text-align:center;color:#857b90;font-size:11px}.foot{padding:22px 0 26px;color:#625b6b;font-size:10px;text-align:center}
@media(max-width:620px){.shell{width:min(100% - 18px,1100px)}.app-controls{display:block}.search-box{min-width:0;width:100%;margin-bottom:8px}.filter-bar{width:100%}.topbar{height:58px}.brand-copy small,.top-status{display:none}main{padding-top:10px}.official-card{grid-template-columns:48px minmax(0,1fr);gap:10px;padding:10px}.official-icon{width:46px;height:46px;border-radius:12px;font-size:20px}.official-title h1{font-size:17px}.official-desc{font-size:9px}.official-meta{font-size:9px}.direct-url{display:none}.official-download{grid-column:1/-1;width:100%;min-height:46px}.apps-section{padding-top:14px}.apps-head h2{font-size:16px}.app-row{grid-template-columns:44px minmax(0,1fr) auto;gap:9px;min-height:62px;padding:8px}.app-icon{width:42px;height:42px}.app-icon img{width:36px;height:36px}.app-title-line h3{font-size:13px}.mini-badge{display:none}.app-desc{font-size:9px}.device-tag{font-size:8px}.app-actions{min-width:94px}.app-download{min-width:94px;min-height:38px;padding:7px 9px;font-size:10px}.app-more{font-size:8px}.app-details{grid-column:1/-1;padding:7px 5px}.app-details span{font-size:8px}.stable-download-link{grid-template-columns:1fr auto}.stable-download-link strong{grid-column:1/-1}.copy-link{min-height:30px}}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
/* BLOFY responsive download UI v2 — 2026-09-26 */
.shell{width:min(1180px,calc(100% - clamp(20px,4vw,64px)))}
.topbar{position:sticky;top:0;z-index:40;height:auto;min-height:76px;padding-block:max(9px,env(safe-area-inset-top)) 9px;background:rgba(8,7,14,.86);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.top-links{display:flex;align-items:center;gap:4px;margin-inline:auto;min-width:0}
.top-links a{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 11px;border-radius:10px;color:#a99fb5;text-decoration:none;font-size:11px;font-weight:800;white-space:nowrap}
.top-links a:hover{color:#fff;background:rgba(255,255,255,.055)}
main{padding:26px 0 38px}
.official-card{grid-template-columns:74px minmax(0,1fr) auto;gap:20px;padding:20px 22px;border-radius:22px}
.official-icon{width:68px;height:68px;border-radius:18px}.official-icon img{width:60px;height:60px}
.official-title h1{font-size:27px}.badge{font-size:11px;padding:6px 10px}
.official-desc{margin-top:8px;font-size:13px;line-height:1.65;white-space:normal}
.official-meta{margin-top:8px;font-size:12px}.direct-url{font-size:10px}
.official-download{min-width:190px;min-height:54px;font-size:14px;border-radius:15px}
.apps-section{padding-top:28px}.apps-head{margin-bottom:14px}.apps-head h2{font-size:22px}.apps-count{min-width:32px;height:32px;font-size:12px}
.app-controls{gap:10px;margin-bottom:14px}.search-box{height:46px;border-radius:14px}.search-box input{font-size:13px}
.filter-chip{min-height:40px;padding:8px 13px;font-size:11px}
.app-list{gap:10px}
.app-row{grid-template-columns:60px minmax(0,1fr) auto;gap:16px;min-height:86px;padding:13px 14px;border-radius:17px}
.app-icon{width:56px;height:56px;border-radius:14px;font-size:11px}.app-icon img{width:49px;height:49px}
.app-title-line{gap:8px;flex-wrap:wrap}.app-title-line h3{font-size:16px}.app-version{font-size:10px}.mini-badge{font-size:9px}
.app-desc{margin-top:5px;font-size:12px;line-height:1.55}.device-tag{margin-top:5px;font-size:10px}
.app-actions{min-width:132px;gap:6px}.app-download{min-width:132px;min-height:43px;font-size:12px}.app-more{min-height:32px;font-size:9px}
.app-details{gap:8px;padding:11px 12px;font-size:10px}.app-details span{padding:5px 8px}.app-details b{font-size:9px}
.stable-download-link{padding:8px 10px}.stable-download-link strong,.stable-download-link a,.copy-link{font-size:9px}.copy-link{min-height:30px}
.variant-link{min-height:31px;font-size:9px}.variant-guide{font-size:9px}
.foot{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:24px 0 max(28px,env(safe-area-inset-bottom));font-size:11px;text-align:initial}
.foot nav{display:flex;gap:6px;flex-wrap:wrap}.foot a{display:inline-flex;align-items:center;min-height:36px;padding:0 9px;border-radius:9px;color:#887e93;text-decoration:none}.foot a:hover{color:#fff;background:rgba(255,255,255,.05)}
@media(min-width:1500px) and (min-height:780px){
  .shell{width:min(1380px,calc(100% - 96px))}
  .topbar{min-height:84px}.top-links a{min-height:46px;font-size:12px}
  .official-card{padding:24px 26px}.official-title h1{font-size:30px}.official-desc{font-size:14px}
  .app-row{min-height:94px;padding:15px 17px}.app-title-line h3{font-size:17px}.app-desc{font-size:13px}
  .app-download{min-height:48px}.app-more{min-height:36px}
}
@media(max-width:900px){
  .topbar{flex-wrap:wrap;gap:8px}.top-links{order:3;width:100%;justify-content:flex-start;overflow-x:auto;scrollbar-width:none}.top-links::-webkit-scrollbar{display:none}
  .official-card{grid-template-columns:64px minmax(0,1fr)}.official-download{grid-column:1/-1;width:100%}
  .top-status{margin-inline-start:auto}
}
@media(max-width:680px){
  .shell{width:min(100% - 16px,1180px)}
  .topbar{min-height:64px;padding-block:8px}.brand-copy small,.top-status{display:none}
  .top-links a{min-height:38px;padding-inline:9px;font-size:10px}
  main{padding-top:14px}
  .official-card{grid-template-columns:52px minmax(0,1fr);gap:11px;padding:12px}
  .official-icon{width:50px;height:50px;border-radius:13px}.official-icon img{width:45px;height:45px}
  .official-title h1{font-size:19px}.official-desc{font-size:11px}.official-meta{font-size:10px}.direct-url{display:none}
  .official-download{min-height:48px}
  .apps-section{padding-top:20px}.apps-head h2{font-size:18px}
  .app-controls{display:block}.search-box{min-width:0;width:100%;margin-bottom:9px}.filter-bar{width:100%}
  .app-row{grid-template-columns:50px minmax(0,1fr);gap:10px;min-height:0;padding:11px}
  .app-icon{width:47px;height:47px}.app-icon img{width:41px;height:41px}
  .app-title-line h3{font-size:14px}.app-desc{font-size:10px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.device-tag{font-size:9px}
  .app-actions{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;min-width:0}.app-download{width:100%;min-width:0;min-height:42px}.app-more{min-width:82px;min-height:42px}
  .app-details{grid-column:1/-1;padding:9px 4px}.stable-download-link{grid-template-columns:1fr auto}.stable-download-link strong{grid-column:1/-1}.stable-download-link a{font-size:8px}
  .foot{align-items:flex-start;flex-direction:column}
}
@media(max-width:420px){
  .brand-copy strong{font-size:12px}.mark{width:34px;height:34px}.mark img{width:31px;height:31px}
  .top-links{margin-inline:0}.filter-chip{min-height:38px;padding-inline:10px}
  .official-title h1{font-size:18px}.badge{font-size:9px}
  .app-row{grid-template-columns:44px minmax(0,1fr)}.app-icon{width:42px;height:42px}.app-icon img{width:36px;height:36px}
  .app-actions{grid-template-columns:1fr}.app-more{width:100%}
}
@media(pointer:coarse){.official-download,.app-download,.app-more,.filter-chip,.copy-link,.variant-link,.top-links a{min-height:44px}}
</style></head><body><div class="shell"><header class="topbar"><div class="brand"><div class="mark"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY PLAYER"></div><span class="brand-copy"><strong>BLOFY PLAYER</strong><small>DOWNLOAD CENTER</small></span></div><nav class="top-links" aria-label="روابط BLOFY"><a href="https://blofyplayer.com/">بوابة الجهاز</a><a href="https://blofyplayer.com/privacy">الخصوصية</a><a href="https://blofyplayer.com/status">حالة الخدمات</a></nav><div class="top-status">مركز التحميل متصل</div></header><main><section class="official-card"><div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY PLAYER"></div><div class="official-copy"><div class="official-title"><h1>BLOFY PLAYER</h1><span class="badge">معتمد</span></div><div class="official-desc">مشغل وسائط احترافي للشاشات والرسيفرات، مصمم لتجربة سريعة وسلسة لتصفح وتشغيل القنوات المباشرة والأفلام والمسلسلات مع دعم كامل للريموت.</div><div class="official-meta">${escapeHtml(release.versionName)} · Version Code ${release.versionCode}</div><div class="direct-url">${escapeHtml(directUrl)}</div></div><a class="official-download" href="/d/blofy">تحميل BLOFY APK ↓</a></section>${renderAppLibrary(apps, variants, rootUrl)}</main><footer class="foot"><span>BLOFY PLAYER · blofyplayer.com</span><nav aria-label="روابط BLOFY"><a href="https://blofyplayer.com/">بوابة الجهاز</a><a href="https://blofyplayer.com/privacy">الخصوصية</a><a href="https://blofyplayer.com/status">حالة الخدمات</a></nav></footer></div><script>
(() => {
  const rows = [...document.querySelectorAll('[data-app-row]')];
  const search = document.getElementById('app-search');
  const chips = [...document.querySelectorAll('.filter-chip')];
  const count = document.getElementById('visible-count');
  const empty = document.getElementById('empty-state');
  const clear = document.getElementById('search-clear');
  let activeFilter = 'all';
  const requestedApp = (() => {
    try {
      const querySlug = new URLSearchParams(location.search).get('app');
      const hashSlug = location.hash.startsWith('#app-') ? location.hash.slice(5) : '';
      return String(querySlug || hashSlug || '').trim().toLowerCase();
    } catch {
      return '';
    }
  })();
  try {
    activeFilter = sessionStorage.getItem('blofy-app-filter') || 'all';
    if (search) search.value = sessionStorage.getItem('blofy-app-search') || '';
  } catch {}
  const normalize = value => String(value || '').toLocaleLowerCase('ar');

  function applyFilters() {
    const query = normalize(search?.value).trim();
    let visible = 0;
    for (const row of rows) {
      const categoryOk = activeFilter === 'all'
        || (activeFilter === 'tv' && row.dataset.tv === '1')
        || row.dataset.category === activeFilter;
      const searchOk = !query || normalize(row.dataset.search).includes(query);
      row.hidden = !(categoryOk && searchOk);
      if (!row.hidden) visible++;
    }
    if (count) count.textContent = String(visible);
    if (empty) empty.hidden = visible !== 0;
    if (clear) clear.hidden = !String(search?.value || '').trim();
    try {
      sessionStorage.setItem('blofy-app-search', search?.value || '');
      sessionStorage.setItem('blofy-app-filter', activeFilter);
    } catch {}
  }

  search?.addEventListener('input', applyFilters);
  clear?.addEventListener('click', () => {
    if (!search) return;
    search.value = '';
    applyFilters();
    search.focus();
  });
  let restoredFilter = false;
  for (const chip of chips) {
    if ((chip.dataset.filter || 'all') === activeFilter) {
      chips.forEach(item => item.classList.toggle('active', item === chip));
      restoredFilter = true;
    }
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter || 'all';
      chips.forEach(item => item.classList.toggle('active', item === chip));
      applyFilters();
    });
  }

  if (!restoredFilter) {
    activeFilter = 'all';
    chips.forEach(item => item.classList.toggle('active', item.dataset.filter === 'all'));
  }

  document.querySelectorAll('.app-icon img').forEach(img => {
    img.addEventListener('error', () => img.closest('.app-icon')?.classList.add('icon-error'), { once:true });
  });

  function setRowDetails(row, open, syncUrl = false) {
    const panel = row?.querySelector('.app-details');
    const button = row?.querySelector('[data-details-toggle]');
    if (!panel || !button) return;
    if (open) {
      for (const other of rows) {
        if (other === row) continue;
        const otherPanel = other.querySelector('.app-details');
        const otherButton = other.querySelector('[data-details-toggle]');
        if (!otherPanel || !otherButton || otherPanel.hidden) continue;
        otherPanel.hidden = true;
        otherButton.setAttribute('aria-expanded', 'false');
        otherButton.textContent = otherButton.dataset.defaultLabel || 'تفاصيل';
        other.classList.remove('app-target');
      }
    }
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.textContent = open ? 'إغلاق' : (button.dataset.defaultLabel || 'تفاصيل');
    row.classList.toggle('app-target', open);
    if (syncUrl) {
      try {
        const nextUrl = new URL(location.href);
        if (open) nextUrl.searchParams.set('app', row.dataset.slug || '');
        else if (nextUrl.searchParams.get('app') === row.dataset.slug) nextUrl.searchParams.delete('app');
        nextUrl.hash = '';
        history.replaceState(null, '', nextUrl);
      } catch {}
    }
  }

  document.querySelectorAll('[data-details-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const row = button.closest('[data-app-row]');
      const panel = row?.querySelector('.app-details');
      if (!row || !panel) return;
      const willOpen = panel.hidden;
      setRowDetails(row, willOpen, true);
      if (willOpen) row.scrollIntoView({ block:'nearest', behavior:'smooth' });
    });
  });

  document.querySelectorAll('[data-copy-url]').forEach(button => {
    button.addEventListener('click', async () => {
      const value = String(button.dataset.copyUrl || '');
      if (!value) return;
      const original = button.textContent;
      let copied = false;
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        try {
          const field = document.createElement('textarea');
          field.value = value;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          copied = document.execCommand('copy');
          field.remove();
        } catch {}
      }
      button.textContent = copied ? 'تم النسخ ✓' : 'انسخ يدويًا';
      setTimeout(() => { button.textContent = original; }, 1800);
    });
  });

  document.addEventListener('focusin', event => {
    const row = event.target?.closest?.('[data-app-row]');
    if (!row?.dataset?.slug) return;
    try { sessionStorage.setItem('blofy-app-focus', row.dataset.slug); } catch {}
  });

  function visibleRows() {
    return rows.filter(row => !row.hidden);
  }

  function firstVisibleDownload() {
    return visibleRows()[0]?.querySelector('.app-download') || document.querySelector('.official-download');
  }

  document.addEventListener('keydown', event => {
    const target = event.target;
    if (target === search && event.key === 'ArrowDown') {
      const first = firstVisibleDownload();
      if (first) { event.preventDefault(); first.focus(); }
      return;
    }
    if (target?.classList?.contains('filter-chip')) {
      const index = chips.indexOf(target);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = event.key === 'ArrowLeft' ? 1 : -1;
        const next = chips[(index + step + chips.length) % chips.length];
        if (next) { event.preventDefault(); next.focus(); }
      } else if (event.key === 'ArrowDown') {
        const first = firstVisibleDownload();
        if (first) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (target?.matches?.('.official-download') && event.key === 'ArrowDown') {
      const first = firstVisibleDownload();
      if (first && first !== target) {
        event.preventDefault();
        first.focus();
        first.scrollIntoView({ block:'nearest', behavior:'smooth' });
      }
      return;
    }

    if (target?.matches?.('.variant-link')) {
      const row = target.closest('[data-app-row]');
      const links = [...(row?.querySelectorAll('.variant-link') || [])];
      const index = links.indexOf(target);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = event.key === 'ArrowLeft' ? 1 : -1;
        const next = links[(index + step + links.length) % links.length];
        if (next) { event.preventDefault(); next.focus(); }
        return;
      }
      if (event.key === 'ArrowUp') {
        const more = row?.querySelector('.app-more');
        if (more) { event.preventDefault(); more.focus(); }
        return;
      }
      if (event.key === 'ArrowDown') {
        const visible = visibleRows();
        const rowIndex = visible.indexOf(row);
        const next = visible[rowIndex + 1]?.querySelector('.app-more');
        if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block:'nearest', behavior:'smooth' }); }
        return;
      }
    }

    if (target?.matches?.('.app-download,.app-more')) {
      const row = target.closest('[data-app-row]');
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && row) {
        const sibling = target.classList.contains('app-download')
          ? row.querySelector('.app-more')
          : row.querySelector('.app-download');
        if (sibling) {
          event.preventDefault();
          sibling.focus();
        }
        return;
      }
      if (event.key === 'ArrowDown' && target.classList.contains('app-more') && row) {
        const panel = row.querySelector('.app-details');
        const firstVariant = !panel?.hidden ? row.querySelector('.variant-link') : null;
        if (firstVariant) {
          event.preventDefault();
          firstVariant.focus();
          return;
        }
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && row) {
        const visible = visibleRows();
        const index = visible.indexOf(row);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const nextRow = visible[index + step];
        const next = nextRow?.querySelector(target.classList.contains('app-more') ? '.app-more' : '.app-download');
        if (next) {
          event.preventDefault();
          next.focus();
          next.scrollIntoView({ block:'nearest', behavior:'smooth' });
        }
      }
    }
  });
  if (requestedApp) {
    activeFilter = 'all';
    if (search) search.value = '';
    chips.forEach(item => item.classList.toggle('active', item.dataset.filter === 'all'));
  }
  applyFilters();

  requestAnimationFrame(() => {
    const linkedRow = requestedApp ? rows.find(row => row.dataset.slug === requestedApp) : null;
    if (linkedRow && !linkedRow.hidden) {
      setRowDetails(linkedRow, true, false);
      const appName = linkedRow.querySelector('h3')?.textContent?.trim();
      if (appName) document.title = appName + ' | BLOFY PLAYER';
      linkedRow.scrollIntoView({ block:'center', behavior:'auto' });
      linkedRow.querySelector('.app-download')?.focus();
      return;
    }

    if (!requestedApp && document.referrer.startsWith(location.origin)) {
      try {
        const savedSlug = sessionStorage.getItem('blofy-app-focus') || '';
        const savedRow = rows.find(row => row.dataset.slug === savedSlug && !row.hidden);
        savedRow?.querySelector('.app-download')?.focus();
      } catch {}
    }
  });
})();
</script></body></html>`;
}

function scheduleManagedAppRefresh() {
  const run = async () => {
    try {
      const result = await refreshManagedApps();
      if (!result.skipped) {
        console.log(`BLOFY app refresh checked=${result.checked || 0} updated=${result.updated || 0} failed=${result.failed || 0}`);
      }
    } catch (error) {
      console.error('BLOFY app refresh failed:', error?.message || error);
    }
    try {
      const health = await refreshAppHealth();
      if (!health.skipped) {
        console.log(`BLOFY app health checked=${health.checked || 0} healthy=${health.healthy || 0} failed=${health.failed || 0}`);
      }
    } catch (error) {
      console.error('BLOFY app health failed:', error?.message || error);
    }
  };

  const firstRun = setTimeout(run, 15000);
  firstRun.unref?.();
  const timer = setInterval(run, APP_REFRESH_INTERVAL_MS);
  timer.unref?.();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || '';

    if (method === 'POST' && pathname === '/api/internal/releases/upload') {
      return await receiveReleaseUpload(req, res, url);
    }

    const localReleaseMatch = pathname.match(/^\/files\/releases\/([a-z0-9._-]+\.apk)$/i);
    if (localReleaseMatch) {
      if (!['GET', 'HEAD'].includes(method)) {
        res.writeHead(405, { ...securityHeaders, allow: 'GET, HEAD', 'cache-control': 'no-store' });
        return res.end();
      }
      return await streamLocalApk(req, res, localReleaseMatch[1], localReleaseMatch[1], 'direct-release');
    }

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

    if (pathname === '/download/qa.apk' || pathname === '/d/blofy-qa') {
      if (method === 'GET') {
        recordDownload('blofy-qa').catch(error => console.error('BLOFY QA download stat failed:', error?.message || error));
      }
      return await streamApkDownload(req, res, QA_APK_URL, 'BLOFY-PLAYER-QA-PRODUCTION-SIGNED.apk', 'blofy-qa');
    }

    if (pathname === '/download/latest.apk' || pathname === '/d/blofy') {
      const release = getActiveRelease();
      if (method === 'GET') {
        recordDownload('blofy').catch(error => console.error('BLOFY download stat failed:', error?.message || error));
      }
      return await streamApkDownload(req, res, release.downloadUrl, `BLOFY-PLAYER-${release.versionName}.apk`, 'blofy');
    }

    const variantMatch = pathname.match(/^\/(?:d|apps|download\/apps)\/([a-z0-9-]+)\/([a-z0-9-]+)$/i);
    if (variantMatch) {
      const variant = await getAppVariant(decodeURIComponent(variantMatch[1]), decodeURIComponent(variantMatch[2]));
      if (!variant) return sendJson(req, res, 404, { ok: false, error: 'variant_not_found' });
      if (method === 'GET') {
        recordDownload(`app:${variant.slug}`).catch(error => console.error('Variant download stat failed:', error?.message || error));
      }
      return await streamApkDownload(req, res, variant.downloadUrl, `${variant.slug}-${variant.key}.apk`, `app:${variant.slug}`);
    }

    const appMatch = pathname.match(/^\/(?:d|apps|download\/apps)\/([a-z0-9-]+)$/i);
    if (appMatch) {
      const app = await getApp(decodeURIComponent(appMatch[1]));
      if (!app) return sendJson(req, res, 404, { ok: false, error: 'app_not_found' });
      if (method === 'GET') {
        recordDownload(`app:${app.slug}`).catch(error => console.error('App download stat failed:', error?.message || error));
      }
      return await streamApkDownload(req, res, app.downloadUrl, `${app.slug}.apk`, `app:${app.slug}`);
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
await importReleaseArtifactIfConfigured().catch(error => {
  console.error('release artifact import failed:', error?.message || error);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLOFY Azure update distribution listening on ${PORT}`);
  scheduleManagedAppRefresh();
});
