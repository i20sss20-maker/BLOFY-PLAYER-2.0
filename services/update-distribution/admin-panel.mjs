import crypto from 'node:crypto';
import { getActiveRelease, listReleases, upsertRelease, promoteRelease, activateRelease, deleteRelease } from './release-store.mjs';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');

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
      'www-authenticate': 'Basic realm="BLOFY Admin", charset="UTF-8"',
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

function stageMeta(stage) {
  if (stage === 'draft') return { label: 'DRAFT', arabic: 'مسودة', className: 'draft', next: 'إرسال إلى QA' };
  if (stage === 'qa') return { label: 'QA', arabic: 'تحت الاختبار', className: 'qa', next: 'اعتماد Public' };
  return { label: 'PUBLIC', arabic: 'جاهزة للنشر', className: 'public', next: '' };
}

function shell(body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080812"><title>BLOFY | إدارة الإصدارات</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 70% 8%,#42177a 0,#170c2d 28%,#080812 68%);color:#fff;padding:24px}.wrap{width:min(1120px,100%);margin:auto}.card{background:rgba(18,15,30,.94);border:1px solid rgba(164,106,255,.25);border-radius:22px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.36);margin-bottom:18px}.brand{font-weight:900;letter-spacing:.08em;color:#caa7ff}.muted{color:#a69caf}.ok{color:#72e3a6}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.full{grid-column:1/-1}label{display:block;color:#c9c1d4;font-size:13px;margin:0 0 7px}input,textarea{width:100%;border:1px solid #49365f;border-radius:12px;background:#0e0c16;color:#fff;padding:12px 13px;font:inherit}textarea{min-height:100px;resize:vertical}.btn,button{border:0;border-radius:12px;padding:12px 18px;font:inherit;font-weight:800;cursor:pointer;background:#7c3aed;color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.secondary{background:#26202f!important}.danger{background:#692738!important}.qa-action{background:#a16207!important}.public-action{background:#16794d!important}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.pill{display:inline-flex;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800}.pill.draft{background:#302d38;color:#d4cedd}.pill.qa{background:#4b350c;color:#f9db87}.pill.public{background:#123d2c;color:#8cf0bd}.release{padding:18px;border:1px solid #352642;border-radius:16px;background:#100d18;margin-top:14px}.release.active{border-color:#8b5cf6;box-shadow:inset 0 0 0 1px #8b5cf6}.release h3{margin:0 0 6px}.code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all;background:#0a0910;padding:9px;border-radius:10px;color:#bbb3c7}.top{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}.flash{padding:12px 14px;border-radius:12px;background:#211735;color:#e8dcff;margin:14px 0}.flow{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}.flow div{padding:12px;border:1px solid #382a49;border-radius:12px;text-align:center;background:#0e0c16}.flow strong{display:block;color:#d9c5ff;margin-bottom:4px}@media(max-width:760px){body{padding:14px}.grid,.flow{grid-template-columns:1fr}.full{grid-column:auto}.card{padding:18px}}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

export function renderAdmin(message = '') {
  const current = getActiveRelease();
  const releases = listReleases();
  const blocks = releases.map((release) => {
    const active = release.versionCode === current.versionCode;
    const stage = stageMeta(release.stage);
    let stageAction = '';
    if (release.stage === 'draft' || release.stage === 'qa') {
      stageAction = `<form method="post" action="/admin/promote"><input type="hidden" name="versionCode" value="${release.versionCode}"><button class="${release.stage === 'qa' ? 'public-action' : 'qa-action'}" type="submit">${stage.next}</button></form>`;
    }
    const activateAction = !active && release.stage === 'public'
      ? `<form method="post" action="/admin/activate"><input type="hidden" name="versionCode" value="${release.versionCode}"><button type="submit">تعيين كتحديث عام</button></form>`
      : '';
    const deleteAction = active ? '' : `<form method="post" action="/admin/delete"><input type="hidden" name="versionCode" value="${release.versionCode}"><button class="danger" type="submit">حذف</button></form>`;
    return `<section class="release${active ? ' active' : ''}"><div class="top"><div><h3>${escapeHtml(release.versionName)} ${active ? '<span class="pill public">التحديث العام الآن</span>' : ''}</h3><div class="row"><span class="pill ${stage.className}">${stage.label} · ${stage.arabic}</span><span class="muted">Version Code: ${release.versionCode} · Min: ${release.minSupportedVersionCode}</span></div></div><div class="row">${stageAction}${activateAction}${deleteAction}</div></div><details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700">تعديل بيانات النسخة</summary><form method="post" action="/admin/save" style="margin-top:14px"><div class="grid"><div><label>Version Code</label><input type="number" name="versionCode" min="1" value="${release.versionCode}" readonly required></div><div><label>Version Name</label><input name="versionName" value="${escapeHtml(release.versionName)}" required></div><div class="full"><label>رابط APK</label><input type="url" name="downloadUrl" value="${escapeHtml(release.downloadUrl)}" required></div><div><label>أقل Version Code مدعوم</label><input type="number" name="minSupportedVersionCode" min="1" value="${release.minSupportedVersionCode}" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes">${escapeHtml(release.releaseNotes)}</textarea></div></div><button style="margin-top:12px" type="submit">حفظ التعديلات</button></form></details><div class="code" style="margin-top:12px">${escapeHtml(release.downloadUrl)}</div></section>`;
  }).join('');

  return shell(`<header class="card"><div class="top"><div><div class="brand">BLOFY PLAYER · RAILWAY RELEASES</div><h1 style="margin-bottom:8px">لوحة إدارة الإصدارات</h1><div class="muted">التحديث العام الآن: <strong class="ok">${escapeHtml(current.versionName)}</strong> · ${current.versionCode}</div></div><div class="row"><a class="btn secondary" href="/" target="_blank" rel="noreferrer">صفحة العميل</a></div></div>${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}<div class="flow"><div><strong>1 · DRAFT</strong><span class="muted">إضافة وتجهيز بيانات النسخة</span></div><div><strong>2 · QA</strong><span class="muted">نسخة اختبار قبل العميل</span></div><div><strong>3 · PUBLIC</strong><span class="muted">مسموح تعيينها كتحديث عام</span></div></div></header><section class="card"><h2>إضافة نسخة جديدة</h2><p class="muted">أي نسخة جديدة تدخل <strong>DRAFT</strong> تلقائيًا. لن تظهر كتحديث للعملاء حتى تمر QA ثم Public ثم تعيّنها كتحديث عام.</p><form method="post" action="/admin/save"><div class="grid"><div><label>Version Code</label><input type="number" name="versionCode" min="1" placeholder="2000062" required></div><div><label>Version Name</label><input name="versionName" placeholder="2.0.0-rc07.51" required></div><div class="full"><label>رابط APK المباشر (HTTPS)</label><input type="url" name="downloadUrl" placeholder="https://...apk" required></div><div><label>أقل Version Code مدعوم</label><input type="number" name="minSupportedVersionCode" min="1" value="1" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes" placeholder="وش تغير في النسخة..."></textarea></div></div><button style="margin-top:12px" type="submit">إضافة كـ DRAFT</button></form></section><section class="card"><div class="top"><div><h2 style="margin:0">الإصدارات المحفوظة</h2><div class="muted">عددها: ${releases.length}</div></div><span class="pill public">Draft → QA → Public → تحديث عام</span></div>${blocks}</section>`);
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
    return release.stage === 'draft'
      ? 'تم حفظ النسخة كـ DRAFT. الخطوة التالية: إرسالها إلى QA.'
      : `تم حفظ بيانات ${release.versionName} بدون تغيير مرحلتها.`;
  }
  if (action === '/admin/promote') {
    const release = await promoteRelease(form.get('versionCode'));
    return release.stage === 'qa'
      ? `تم نقل ${release.versionName} إلى QA. اختبرها قبل Public.`
      : `تم اعتماد ${release.versionName} كـ PUBLIC. ما زالت لن تصبح التحديث العام حتى تضغط تعيين كتحديث عام.`;
  }
  if (action === '/admin/activate') {
    const release = await activateRelease(form.get('versionCode'));
    return `تم تعيين ${release.versionName} كتحديث عام. رابط Latest يشير لها الآن.`;
  }
  if (action === '/admin/delete') {
    await deleteRelease(form.get('versionCode'));
    return 'تم حذف النسخة من لوحة الإصدارات.';
  }
  throw new Error('unknown_admin_action');
}
