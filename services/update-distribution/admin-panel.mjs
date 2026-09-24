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
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08070e"><meta name="robots" content="noindex,nofollow"><meta name="description" content="لوحة BLOFY الداخلية لإدارة إصدارات التطبيق والتحديث العام."><link rel="icon" type="image/png" href="https://blofyplayer.com/blofy-logo.png"><title>BLOFY | إدارة الإصدارات</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark;--bg:#08070e;--line:rgba(190,149,255,.16);--muted:#aaa1b5;--green:#77e1ac}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% -12%,rgba(119,48,220,.28),transparent 34rem),radial-gradient(circle at -10% 90%,rgba(38,67,190,.12),transparent 28rem),linear-gradient(145deg,#08070d,#0d0913 54%,#08070d);color:#fff;padding:24px}body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.01) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black,transparent 82%)}.wrap{width:min(1160px,100%);margin:auto}.card,.release{position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(25,20,36,.91),rgba(12,10,17,.95));border:1px solid var(--line);border-radius:24px;padding:25px;margin-bottom:16px;box-shadow:0 18px 60px rgba(0,0,0,.16)}.card:before,.release:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(191,151,255,.31),transparent)}.hero-card{padding:30px}.brand{color:#c9a9ff;font-weight:900;letter-spacing:.12em;font-size:11px;direction:ltr}.muted{color:var(--muted);line-height:1.7}.ok{color:var(--green)}h1{font-size:clamp(32px,5vw,48px);margin:10px 0 7px;line-height:1.15}h2{font-size:24px;margin:0 0 8px}h3{font-size:21px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.full{grid-column:1/-1}label{display:block;color:#c8bed4;font-size:12px;font-weight:700;margin-bottom:7px}input,textarea{width:100%;background:rgba(8,7,12,.72);color:#fff;border:1px solid rgba(188,145,247,.18);border-radius:13px;padding:12px 13px;font:inherit;outline:0;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease}input:hover,textarea:hover{border-color:rgba(196,154,255,.3)}input:focus,textarea:focus{border-color:#9f76ff;background:#0d0a13;box-shadow:0 0 0 4px rgba(139,91,255,.1)}textarea{min-height:100px;resize:vertical}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top{display:flex;justify-content:space-between;gap:18px;align-items:center;flex-wrap:wrap}.btn,button{border:1px solid rgba(255,255,255,.06);border-radius:13px;background:linear-gradient(115deg,#8d5cf1,#7141dc);color:#fff;font-weight:900;padding:11px 15px;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:transform .17s ease,filter .17s ease,border-color .17s ease}.btn:hover,button:hover{transform:translateY(-1px);filter:brightness(1.08)}.btn:active,button:active{transform:scale(.985)}.secondary{background:rgba(255,255,255,.035)!important;color:#d0c6dd!important}.danger{background:linear-gradient(115deg,#762d42,#5a2233)!important;color:#ffdce4}.qa-action{background:linear-gradient(115deg,#9a6b13,#76500c)!important;color:#fff4d4}.public-action{background:linear-gradient(115deg,#15794d,#105b3a)!important;color:#d7ffeb}.pill{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.07);border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.035);color:#d7cede;font-size:11px;font-weight:900}.pill.draft{color:#d5d0dc}.pill.qa{color:#f3d58a;border-color:rgba(240,201,120,.18);background:rgba(154,103,8,.12)}.pill.public{color:#8ae8ba;border-color:rgba(119,225,172,.18);background:rgba(22,121,77,.13)}.release{transition:transform .18s ease,border-color .18s ease}.release:hover{transform:translateY(-1px);border-color:rgba(187,145,248,.26)}.release.active{border-color:rgba(146,101,255,.55);background:radial-gradient(circle at 12% 0,rgba(139,82,235,.18),transparent 42%),linear-gradient(145deg,rgba(30,23,44,.94),rgba(12,10,17,.96));box-shadow:inset 0 0 0 1px rgba(139,92,246,.22),0 18px 60px rgba(0,0,0,.21)}.release.active:after{content:"ACTIVE";position:absolute;top:17px;left:-31px;transform:rotate(-40deg);padding:4px 35px;background:#7141dc;color:white;font-size:8px;font-weight:900;letter-spacing:.16em}.flash{border:1px solid rgba(177,135,240,.18);background:rgba(101,63,155,.16);color:#eadfff;border-radius:13px;padding:12px 14px;margin-top:16px}.code{direction:ltr;unicode-bidi:plaintext;word-break:break-all;background:rgba(5,4,8,.52);border:1px dashed rgba(184,140,242,.22);border-radius:12px;padding:11px;color:#bfb3cc;font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}details{border-top:1px solid rgba(255,255,255,.05);padding-top:13px}summary{cursor:pointer;color:#cdbde1;font-weight:700;font-size:13px}summary:hover{color:#fff}.flow{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:18px}.flow div{padding:10px 12px;border:1px solid rgba(255,255,255,.055);border-radius:12px;background:rgba(255,255,255,.025);font-size:11px;color:#9f96aa;text-align:center}.flow strong{display:block;color:#ddd0ee;font-size:12px;margin-bottom:2px}.section-label{display:inline-flex;padding:6px 10px;border:1px solid rgba(181,137,244,.18);border-radius:999px;color:#bd9bed;background:rgba(114,65,180,.08);font-size:10px;font-weight:900;letter-spacing:.08em;direction:ltr;margin-bottom:10px}@media(max-width:720px){body{padding:12px}.grid,.flow{grid-template-columns:1fr}.full{grid-column:auto}.card,.release{border-radius:19px;padding:18px}.hero-card{padding:22px}.top{align-items:flex-start}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
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
    return `<section class="release${active ? ' active' : ''}"><div class="top"><div><span class="section-label">RELEASE ${release.versionCode}</span><h3 style="margin:0 0 8px"><span dir="ltr">${escapeHtml(release.versionName)}</span></h3><div class="row"><span class="pill ${stage.className}">${stage.label} · ${stage.arabic}</span>${active ? '<span class="pill public">التحديث العام الآن</span>' : ''}<span class="muted">Min ${release.minSupportedVersionCode}</span></div></div><div class="row">${stageAction}${activateAction}${deleteAction}</div></div><details style="margin-top:16px"><summary>تعديل بيانات النسخة</summary><form method="post" action="/admin/save" style="margin-top:14px"><div class="grid"><div><label>Version Code</label><input type="number" name="versionCode" min="1" value="${release.versionCode}" readonly required></div><div><label>Version Name</label><input name="versionName" value="${escapeHtml(release.versionName)}" required></div><div class="full"><label>رابط APK</label><input type="url" name="downloadUrl" value="${escapeHtml(release.downloadUrl)}" required></div><div><label>أقل Version Code مدعوم</label><input type="number" name="minSupportedVersionCode" min="1" value="${release.minSupportedVersionCode}" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes">${escapeHtml(release.releaseNotes)}</textarea></div></div><button style="margin-top:12px" type="submit">حفظ التعديلات</button></form></details><div class="code" style="margin-top:13px">${escapeHtml(release.downloadUrl)}</div></section>`;
  }).join('');

  return shell(`<header class="card hero-card"><div class="top"><div><div class="brand">BLOFY PLAYER · RELEASE CONTROL</div><h1>لوحة إدارة الإصدارات</h1><div class="muted">التحديث العام الحالي: <strong class="ok"><span dir="ltr">${escapeHtml(current.versionName)}</span></strong> · Code ${current.versionCode}</div><div class="flow"><div><strong>DRAFT</strong>إضافة ومراجعة البيانات</div><div><strong>QA</strong>اختبار النسخة قبل النشر</div><div><strong>PUBLIC</strong>اعتمادها كتحديث عام</div></div></div><a class="btn secondary" href="/" target="_blank" rel="noreferrer">فتح صفحة العميل ↗</a></div>${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}</header><section class="card"><span class="section-label">NEW RELEASE</span><h2>إضافة نسخة جديدة</h2><p class="muted">أي نسخة جديدة تدخل DRAFT تلقائيًا، ثم تمر QA وبعدها PUBLIC قبل تعيينها كتحديث عام.</p><form method="post" action="/admin/save"><div class="grid"><div><label>Version Code</label><input type="number" name="versionCode" min="1" placeholder="2000062" required></div><div><label>Version Name</label><input name="versionName" placeholder="2.0.0-rc07.51" required></div><div class="full"><label>رابط APK المباشر HTTPS</label><input type="url" name="downloadUrl" placeholder="https://...apk" required></div><div><label>أقل Version Code مدعوم</label><input type="number" name="minSupportedVersionCode" min="1" value="1" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes" placeholder="أبرز التغييرات والإصلاحات..."></textarea></div></div><button style="margin-top:12px" type="submit">إضافة كـ DRAFT</button></form></section><section class="card"><div class="top"><div><span class="section-label">RELEASE HISTORY</span><h2 style="margin:0">الإصدارات المحفوظة</h2><div class="muted">عددها: ${releases.length}</div></div><span class="pill public">Draft → QA → Public → تحديث عام</span></div>${blocks}</section>`);
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
