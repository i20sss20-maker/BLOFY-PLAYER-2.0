import crypto from 'node:crypto';
import { getActiveRelease, listReleases, upsertRelease, promoteRelease, activateRelease, deleteRelease } from './release-store.mjs';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const PUBLIC_ADMIN_PREFIX = normalizePrefix(process.env.PUBLIC_ADMIN_PREFIX || '/admin');

function normalizePrefix(value) {
  const clean = `/${String(value || '').trim().replace(/^\/+|\/+$/g, '')}`;
  return clean === '/' ? '/admin' : clean;
}

function actionPath(name) {
  return `${PUBLIC_ADMIN_PREFIX}/${name}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function credentials(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

export function requireAdmin(req, res, securityHeaders) {
  if (!ADMIN_PASSWORD) {
    res.writeHead(503, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Admin password is not configured.');
    return false;
  }
  const auth = credentials(req);
  if (!auth || !safeEqual(auth.user, ADMIN_USER) || !safeEqual(auth.password, ADMIN_PASSWORD)) {
    res.writeHead(401, {
      ...securityHeaders,
      'www-authenticate': 'Basic realm="BLOFY Release Admin", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end('Authentication required.');
    return false;
  }
  return true;
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return origin === `${proto}://${host}`;
}

export async function readForm(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/x-www-form-urlencoded') throw new Error('unsupported_content_type');
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error('body_too_large');
  }
  return new URLSearchParams(body);
}

function stageLabel(stage) {
  if (stage === 'draft') return 'DRAFT · مسودة';
  if (stage === 'qa') return 'QA · تحت الاختبار';
  return 'PUBLIC · جاهزة للنشر';
}

function shell(body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090812"><title>BLOFY PLAYER | Azure Releases</title><style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 75% 0,#401774,#160c2a 32%,#08070d 70%);color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;padding:20px}.wrap{width:min(1080px,100%);margin:auto}.card,.release{background:rgba(18,15,28,.94);border:1px solid #352646;border-radius:20px;padding:22px;margin-bottom:16px}.brand{color:#caa7ff;font-weight:900;letter-spacing:.08em}.muted{color:#aaa0b6}.ok{color:#78e4ad}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.full{grid-column:1/-1}label{display:block;color:#c8bed4;font-size:13px;margin-bottom:6px}input,textarea{width:100%;background:#0c0a12;color:#fff;border:1px solid #49355e;border-radius:11px;padding:11px;font:inherit}textarea{min-height:90px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}button,.btn{border:0;border-radius:11px;background:#7c3aed;color:#fff;font-weight:800;padding:11px 15px;text-decoration:none;cursor:pointer}.qa{background:#9a6708}.public{background:#16794d}.danger{background:#722b3e}.pill{display:inline-flex;border-radius:999px;padding:6px 10px;background:#292331;color:#d8cfdf;font-size:12px;font-weight:800}.release.active{border-color:#8b5cf6;box-shadow:inset 0 0 0 1px #8b5cf6}.flash{background:#211735;color:#eadfff;border-radius:11px;padding:11px;margin-top:14px}.url{direction:ltr;unicode-bidi:plaintext;word-break:break-all;background:#09080d;border-radius:10px;padding:9px;color:#bfb3cc;font:12px ui-monospace,monospace}@media(max-width:720px){body{padding:12px}.grid{grid-template-columns:1fr}.full{grid-column:auto}}
</style></head><body><main class="wrap">${body}</main></body></html>`;
}

export function renderAdmin(message = '') {
  const current = getActiveRelease();
  const releases = listReleases();
  const blocks = releases.map((release) => {
    const active = release.versionCode === current.versionCode;
    const promote = release.stage === 'draft' || release.stage === 'qa'
      ? `<form method="post" action="${actionPath('promote')}"><input type="hidden" name="versionCode" value="${release.versionCode}"><button class="${release.stage === 'qa' ? 'public' : 'qa'}" type="submit">${release.stage === 'qa' ? 'اعتماد Public' : 'إرسال إلى QA'}</button></form>`
      : '';
    const activate = !active && release.stage === 'public'
      ? `<form method="post" action="${actionPath('activate')}"><input type="hidden" name="versionCode" value="${release.versionCode}"><button type="submit">تعيين كتحديث عام</button></form>`
      : '';
    const remove = active ? '' : `<form method="post" action="${actionPath('delete')}"><input type="hidden" name="versionCode" value="${release.versionCode}"><button class="danger" type="submit">حذف</button></form>`;
    return `<section class="release${active ? ' active' : ''}"><div class="top"><div><h3 style="margin:0 0 8px">${escapeHtml(release.versionName)}</h3><div class="row"><span class="pill">${stageLabel(release.stage)}</span>${active ? '<span class="pill">التحديث العام الآن</span>' : ''}<span class="muted">Code ${release.versionCode}</span></div></div><div class="row">${promote}${activate}${remove}</div></div><details style="margin-top:14px"><summary>تعديل بيانات النسخة</summary><form method="post" action="${actionPath('save')}" style="margin-top:12px"><div class="grid"><div><label>Version Code</label><input type="number" name="versionCode" value="${release.versionCode}" readonly></div><div><label>Version Name</label><input name="versionName" value="${escapeHtml(release.versionName)}" required></div><div class="full"><label>رابط APK</label><input type="url" name="downloadUrl" value="${escapeHtml(release.downloadUrl)}" required></div><div><label>Min Version Code</label><input type="number" name="minSupportedVersionCode" min="1" value="${release.minSupportedVersionCode}" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes">${escapeHtml(release.releaseNotes)}</textarea></div></div><button style="margin-top:10px" type="submit">حفظ</button></form></details><div class="url" style="margin-top:12px">${escapeHtml(release.downloadUrl)}</div></section>`;
  }).join('');

  return shell(`<section class="card"><div class="top"><div><div class="brand">BLOFY PLAYER · MICROSOFT AZURE</div><h1>إدارة الإصدارات</h1><div class="muted">التحديث الحالي: <strong class="ok">${escapeHtml(current.versionName)}</strong> · ${current.versionCode}</div></div><a class="btn" href="/downloads" target="_blank" rel="noreferrer">صفحة التحميل</a></div>${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}</section><section class="card"><h2>نسخة جديدة</h2><p class="muted">تدخل DRAFT أولًا، ثم QA، ثم PUBLIC، وبعدها فقط يمكن تعيينها كتحديث عام.</p><form method="post" action="${actionPath('save')}"><div class="grid"><div><label>Version Code</label><input type="number" name="versionCode" min="1" placeholder="2000062" required></div><div><label>Version Name</label><input name="versionName" placeholder="2.0.0-rc07.51" required></div><div class="full"><label>رابط APK المباشر HTTPS</label><input type="url" name="downloadUrl" required></div><div><label>Min Version Code</label><input type="number" name="minSupportedVersionCode" min="1" value="1" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes"></textarea></div></div><button style="margin-top:10px" type="submit">إضافة كـ DRAFT</button></form></section><section class="card"><h2>الإصدارات</h2>${blocks}</section>`);
}

export async function handleAdminAction(form, action) {
  if (action === '/admin/save') {
    const release = await upsertRelease({
      versionCode: form.get('versionCode'),
      versionName: form.get('versionName'),
      downloadUrl: form.get('downloadUrl'),
      releaseNotes: form.get('releaseNotes'),
      minSupportedVersionCode: form.get('minSupportedVersionCode')
    });
    return release.stage === 'draft' ? 'تم حفظ النسخة كـ DRAFT.' : `تم حفظ ${release.versionName}.`;
  }
  if (action === '/admin/promote') {
    const release = await promoteRelease(form.get('versionCode'));
    return release.stage === 'qa' ? `تم نقل ${release.versionName} إلى QA.` : `تم اعتماد ${release.versionName} كـ PUBLIC.`;
  }
  if (action === '/admin/activate') {
    const release = await activateRelease(form.get('versionCode'));
    return `تم تعيين ${release.versionName} كتحديث عام.`;
  }
  if (action === '/admin/delete') {
    await deleteRelease(form.get('versionCode'));
    return 'تم حذف النسخة.';
  }
  throw new Error('unknown_admin_action');
}
