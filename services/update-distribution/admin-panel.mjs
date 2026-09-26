import crypto from 'node:crypto';
import { getActiveRelease, listReleases, upsertRelease, promoteRelease, activateRelease, deleteRelease } from './release-store.mjs';
import { listApps, upsertApp, deleteApp, inspectRemoteApk, refreshManagedApps, getAppUpdateState, getDownloadStats, getAppHealthState, refreshAppHealth, rollbackApp, listAppAudit, listCatalogBackups, restoreCatalogBackup } from './app-library.mjs';

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

function isAction(action, name) {
  return action === actionPath(name) || action === `/admin/${name}`;
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
  if (stage === 'draft') return 'مسودة';
  if (stage === 'qa') return 'QA · تحت الاختبار';
  return 'عام · جاهز للنشر';
}

function categoryLabel(category) {
  return ({ media:'مشغلات وميديا', files:'ملفات ونقل', downloads:'تنزيل ومتصفحات', launcher:'واجهات الشاشة', screensaver:'شاشات توقف', tools:'أدوات وصيانة', network:'شبكة وواي فاي', store:'متاجر' })[category] || category;
}

function categoryOptions(current) {
  return [
    ['media','مشغلات وميديا'], ['files','ملفات ونقل'], ['downloads','تنزيل ومتصفحات'],
    ['launcher','واجهات الشاشة'], ['screensaver','شاشات توقف'], ['tools','أدوات وصيانة'], ['network','شبكة وواي فاي'], ['store','متاجر']
  ].map(([value,label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('');
}

function modeOptions(current) {
  return [['direct','تحميل APK مباشر'],['official','رابط خارجي']].map(([value,label]) =>
    `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('');
}

function formatApkSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  const mb = value / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
}

function apkSizeInput(bytes) {
  const value = Number(bytes || 0);
  return value ? (value / (1024 * 1024)).toFixed(2) : '';
}

function apkSizeBytes(value) {
  const mb = Number(String(value || '').trim().replace(',', '.'));
  return Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : 0;
}

function formatAdminTime(ms) {
  if (!ms) return 'لم يتم الفحص بعد';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value || 0)));
}

function auditActionLabel(action) {
  return ({
    app_create:'إضافة تطبيق',
    app_update:'تعديل تطبيق',
    app_delete:'حذف تطبيق',
    app_auto_update:'تحديث تلقائي',
    app_rollback:'رجوع لنسخة سابقة',
    app_health_hidden:'إخفاء تلقائي بسبب الرابط',
    app_health_recovered:'استعادة تلقائية بعد عودة الرابط',
    catalog_backup_restore:'استعادة نسخة احتياطية'
  })[action] || action;
}

function backupReasonLabel(reason) {
  return ({
    before_app_update:'قبل تعديل تطبيق',
    before_app_delete:'قبل حذف تطبيق',
    before_app_rollback:'قبل Rollback',
    before_manual_bulk_refresh:'قبل تحديث جماعي يدوي',
    before_scheduled_bulk_refresh:'قبل تحديث جماعي تلقائي',
    before_backup_restore:'قبل استعادة Backup',
    initial_baseline:'Baseline أولي'
  })[reason] || reason;
}

function shell(body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090812"><title>BLOFY PLAYER | إدارة الإصدارات</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color-scheme:dark;--bg:#08070d;--surface:rgba(20,16,30,.9);--surface2:rgba(30,23,44,.84);--line:rgba(190,149,255,.16);--text:#fff;--muted:#aaa1b5;--purple:#9c70ff;--green:#77e1ac;--amber:#f0c978;--red:#ff889a}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% -12%,rgba(119,48,220,.28),transparent 34rem),radial-gradient(circle at -10% 90%,rgba(38,67,190,.12),transparent 28rem),linear-gradient(145deg,#08070d,#0d0913 54%,#08070d);color:var(--text);padding:24px}body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.01) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black,transparent 82%)}.wrap{width:min(1160px,100%);margin:auto}.card,.release{position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(25,20,36,.91),rgba(12,10,17,.95));border:1px solid var(--line);border-radius:24px;padding:25px;margin-bottom:16px;box-shadow:0 18px 60px rgba(0,0,0,.16)}.card:before,.release:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(191,151,255,.31),transparent)}.hero-card{padding:30px}.brand{color:#c9a9ff;font-weight:900;letter-spacing:.12em;font-size:11px;direction:ltr}.muted{color:var(--muted);line-height:1.7}.ok{color:var(--green)}h1{font-size:clamp(32px,5vw,48px);margin:10px 0 7px;line-height:1.15}h2{font-size:24px;margin:0 0 8px}h3{font-size:21px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.full{grid-column:1/-1}label{display:block;color:#c8bed4;font-size:12px;font-weight:700;margin-bottom:7px}input,textarea,select{width:100%;background:rgba(8,7,12,.72);color:#fff;border:1px solid rgba(188,145,247,.18);border-radius:13px;padding:12px 13px;font:inherit;outline:0;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease}input:hover,textarea:hover,select:hover{border-color:rgba(196,154,255,.3)}input:focus,textarea:focus,select:focus{border-color:#9f76ff;background:#0d0a13;box-shadow:0 0 0 4px rgba(139,91,255,.1)}textarea{min-height:100px;resize:vertical}select{appearance:auto}.checks{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.checks label{display:flex;align-items:center;gap:8px;margin:0}.checks input{width:auto;accent-color:#8d5cf1}.app-symbol{width:48px;height:48px;display:grid;place-items:center;border-radius:14px;background:rgba(139,91,255,.13);border:1px solid rgba(187,145,248,.22);font-weight:900;color:#d9c2ff;direction:ltr}.app-meta{display:flex;align-items:center;gap:12px}.app-off{opacity:.58}.library-note{padding:13px 15px;border-radius:13px;background:rgba(83,55,125,.12);border:1px solid rgba(177,135,240,.14);color:#bdb2ca;font-size:12px;line-height:1.8}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top{display:flex;justify-content:space-between;gap:18px;align-items:center;flex-wrap:wrap}button,.btn{border:1px solid rgba(255,255,255,.06);border-radius:13px;background:linear-gradient(115deg,#8d5cf1,#7141dc);color:#fff;font-weight:900;padding:11px 15px;text-decoration:none;cursor:pointer;transition:transform .17s ease,filter .17s ease,border-color .17s ease}button:hover,.btn:hover{transform:translateY(-1px);filter:brightness(1.08)}button:active,.btn:active{transform:scale(.985)}.qa{background:linear-gradient(115deg,#9a6b13,#76500c);color:#fff4d4}.public{background:linear-gradient(115deg,#15794d,#105b3a);color:#d7ffeb}.danger{background:linear-gradient(115deg,#762d42,#5a2233);color:#ffdce4}.pill{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.07);border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.035);color:#d7cede;font-size:11px;font-weight:900}.health-good{color:#9af0c5;border-color:rgba(90,220,150,.18);background:rgba(39,143,92,.1)}.health-bad{color:#ff9fb0;border-color:rgba(255,110,140,.18);background:rgba(150,42,70,.12)}.metric-list{display:grid;gap:8px;margin-top:14px}.metric-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.055);border-radius:12px;background:rgba(255,255,255,.025)}.metric-row strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metric-row small{color:#91879d}.admin-app-controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:14px 0}.admin-search{flex:1 1 260px;min-width:220px}.admin-filters{display:flex;gap:6px;flex-wrap:wrap}.admin-filter{padding:8px 11px;border-radius:10px;background:rgba(255,255,255,.025);color:#a99fb5;font-size:10px}.admin-filter.active{background:rgba(126,70,255,.16);border-color:rgba(167,127,255,.28);color:#e1d2ff}.admin-app-hidden{display:none!important}.backup-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.055);border-radius:12px;background:rgba(255,255,255,.025)}.backup-row small{color:#91879d}.release{transition:transform .18s ease,border-color .18s ease}.release:hover{transform:translateY(-1px);border-color:rgba(187,145,248,.26)}.release.active{border-color:rgba(146,101,255,.55);background:radial-gradient(circle at 12% 0,rgba(139,82,235,.18),transparent 42%),linear-gradient(145deg,rgba(30,23,44,.94),rgba(12,10,17,.96));box-shadow:inset 0 0 0 1px rgba(139,92,246,.22),0 18px 60px rgba(0,0,0,.21)}.release.active:after{content:"ACTIVE";position:absolute;top:17px;left:-31px;transform:rotate(-40deg);padding:4px 35px;background:#7141dc;color:white;font-size:8px;font-weight:900;letter-spacing:.16em}.flash{border:1px solid rgba(177,135,240,.18);background:rgba(101,63,155,.16);color:#eadfff;border-radius:13px;padding:12px 14px;margin-top:16px}.url{direction:ltr;unicode-bidi:plaintext;word-break:break-all;background:rgba(5,4,8,.52);border:1px dashed rgba(184,140,242,.22);border-radius:12px;padding:11px;color:#bfb3cc;font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}details{border-top:1px solid rgba(255,255,255,.05);padding-top:13px}summary{cursor:pointer;color:#cdbde1;font-weight:700;font-size:13px}summary:hover{color:#fff}.pipeline{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:18px}.pipe{padding:10px 12px;border:1px solid rgba(255,255,255,.055);border-radius:12px;background:rgba(255,255,255,.025);font-size:11px;color:#9f96aa;text-align:center}.pipe strong{display:block;color:#ddd0ee;font-size:12px;margin-bottom:2px}.section-label{display:inline-flex;padding:6px 10px;border:1px solid rgba(181,137,244,.18);border-radius:999px;color:#bd9bed;background:rgba(114,65,180,.08);font-size:10px;font-weight:900;letter-spacing:.08em;direction:ltr;margin-bottom:10px}@media(max-width:720px){body{padding:12px}.admin-app-controls{display:block}.admin-search{width:100%;min-width:0;margin-bottom:8px}.admin-filters{overflow-x:auto;flex-wrap:nowrap}.backup-row{grid-template-columns:1fr auto}.backup-row small{grid-column:1/-1}.grid{grid-template-columns:1fr}.full{grid-column:auto}.card,.release{border-radius:19px;padding:18px}.hero-card{padding:22px}.pipeline{grid-template-columns:1fr}.top{align-items:flex-start}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
/* BLOFY responsive release control v2 — 2026-09-26 */
body{padding:max(18px,env(safe-area-inset-top)) clamp(14px,3vw,30px) max(24px,env(safe-area-inset-bottom));overflow-x:hidden}
.wrap{width:min(1280px,100%)}
.card,.release{border-radius:22px}
.hero-card{padding:30px}
.hero-card>.top{align-items:center;gap:20px}
.pipeline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px}
.pipe{min-width:0}
input,textarea,select,button,.btn{min-height:44px}
.admin-app-controls{align-items:stretch;gap:10px}
.admin-search{min-height:46px}
.admin-filters{align-items:center}
.admin-filter{min-height:40px}
.release>.top{gap:14px;flex-wrap:wrap}
.row{flex-wrap:wrap}
.metric-list{min-width:0}
@media(min-width:1500px) and (min-height:780px){
  .wrap{width:min(1460px,100%)}
  body{font-size:17px}
  .card,.release{padding:28px}
  button,.btn{min-height:48px}
}
@media(max-width:960px){
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hero-card>.top{align-items:flex-start}
  .pipeline{grid-template-columns:1fr 1fr 1fr}
}
@media(max-width:720px){
  body{padding:10px}
  .card,.release{padding:18px;border-radius:19px;margin-bottom:12px}
  .hero-card{padding:20px}
  .hero-card>.top,.release>.top,.top{align-items:stretch;flex-direction:column}
  .hero-card>.top>.btn{width:100%}
  .pipeline{grid-template-columns:1fr;gap:7px}
  .grid{grid-template-columns:1fr!important}
  .full{grid-column:auto!important}
  .admin-app-controls{display:block}
  .admin-search{width:100%;min-width:0;margin-bottom:8px}
  .admin-filters{display:flex;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none;padding-bottom:2px}
  .admin-filters::-webkit-scrollbar{display:none}
  .admin-filter{flex:0 0 auto;white-space:nowrap}
  .row{width:100%}
  .row form{flex:1 1 auto}
  .row form button{width:100%}
  h1{font-size:clamp(30px,10vw,42px)}
  h2{font-size:22px}
}
@media(max-width:480px){
  body{padding:8px}
  .card,.release{padding:16px;border-radius:17px}
  .hero-card{padding:18px}
  input,textarea,select{padding:11px}
}
@media(pointer:coarse){button,.btn,.admin-filter,summary{min-height:46px}}
</style></head><body><main class="wrap">${body}</main><script>
(() => {
  const cards = [...document.querySelectorAll('[data-admin-app]')];
  const search = document.getElementById('admin-app-search');
  const filters = [...document.querySelectorAll('[data-admin-filter]')];
  const count = document.getElementById('admin-visible-count');
  let active = 'all';

  function apply() {
    const query = String(search?.value || '').trim().toLocaleLowerCase('ar');
    let visible = 0;
    for (const card of cards) {
      const health = card.dataset.health || 'unknown';
      const hidden = card.dataset.hidden === '1';
      const auto = card.dataset.auto === '1';
      const matchesFilter = active === 'all'
        || (active === 'healthy' && health === 'healthy')
        || (active === 'broken' && health === 'broken')
        || (active === 'hidden' && hidden)
        || (active === 'auto' && auto);
      const matchesSearch = !query || String(card.dataset.adminSearch || '').toLocaleLowerCase('ar').includes(query);
      card.classList.toggle('admin-app-hidden', !(matchesFilter && matchesSearch));
      if (matchesFilter && matchesSearch) visible++;
    }
    if (count) count.textContent = String(visible);
  }

  search?.addEventListener('input', apply);
  filters.forEach(button => button.addEventListener('click', () => {
    active = button.dataset.adminFilter || 'all';
    filters.forEach(item => item.classList.toggle('active', item === button));
    apply();
  }));
  apply();
})();
</script></body></html>`;
}

export async function renderAdmin(message = '') {
  const current = getActiveRelease();
  const releases = listReleases();
  const [apps, updateState, downloadStats, healthState, auditEntries, backups] = await Promise.all([
    listApps(true),
    getAppUpdateState(),
    getDownloadStats(),
    getAppHealthState(),
    listAppAudit(30),
    listCatalogBackups(10)
  ]);
  const blocks = releases.map((release) => {
    const active = release.versionCode === current.versionCode;
    const promote = release.stage === 'draft' || release.stage === 'qa'
      ? `<form method="post" action="${actionPath('promote')}"><input type="hidden" name="versionCode" value="${release.versionCode}"><button class="${release.stage === 'qa' ? 'public' : 'qa'}" type="submit">${release.stage === 'qa' ? 'اعتماد كإصدار عام' : 'إرسال للاختبار'}</button></form>`
      : '';
    const activate = !active && release.stage === 'public'
      ? `<form method="post" action="${actionPath('activate')}"><input type="hidden" name="versionCode" value="${release.versionCode}"><button type="submit">تعيين كتحديث عام</button></form>`
      : '';
    const remove = active ? '' : `<form method="post" action="${actionPath('delete')}"><input type="hidden" name="versionCode" value="${release.versionCode}"><button class="danger" type="submit">حذف</button></form>`;
    return `<section class="release${active ? ' active' : ''}"><div class="top"><div><span class="section-label">الإصدار ${release.versionCode}</span><h3 style="margin:0 0 8px"><span dir="ltr">${escapeHtml(release.versionName)}</span></h3><div class="row"><span class="pill">${stageLabel(release.stage)}</span>${active ? '<span class="pill">التحديث العام الآن</span>' : ''}<span class="muted">رمز الإصدار ${release.versionCode}</span></div></div><div class="row">${promote}${activate}${remove}</div></div><details style="margin-top:16px"><summary>تعديل بيانات النسخة</summary><form method="post" action="${actionPath('save')}" style="margin-top:14px"><div class="grid"><div><label>رمز الإصدار</label><input type="number" name="versionCode" value="${release.versionCode}" readonly></div><div><label>اسم الإصدار</label><input name="versionName" value="${escapeHtml(release.versionName)}" required></div><div class="full"><label>رابط APK</label><input type="url" name="downloadUrl" value="${escapeHtml(release.downloadUrl)}" required></div><div><label>Min رمز الإصدار</label><input type="number" name="minSupportedVersionCode" min="1" value="${release.minSupportedVersionCode}" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes">${escapeHtml(release.releaseNotes)}</textarea></div></div><button style="margin-top:12px" type="submit">حفظ التعديلات</button></form></details><div class="url" style="margin-top:13px">${escapeHtml(release.downloadUrl)}</div></section>`;
  }).join('');

  const appBlocks = apps.map((app) => {
    const health = healthState.bySlug?.[app.slug];
    const autoHidden = Number(health?.consecutiveFailures || 0) >= 2;
    const healthKind = !health?.checkedAt ? 'unknown' : (health.ok ? 'healthy' : 'broken');
    const hidden = !app.enabled || autoHidden;
    const adminSearch = [app.name, app.slug, categoryLabel(app.category), app.version, app.devices].filter(Boolean).join(' ');
    return `<section class="release${app.enabled ? '' : ' app-off'}" data-admin-app data-health="${healthKind}" data-hidden="${hidden ? '1' : '0'}" data-auto="${app.autoUpdate ? '1' : '0'}" data-admin-search="${escapeHtml(adminSearch)}"><div class="top"><div class="app-meta"><div class="app-symbol">${escapeHtml(app.symbol)}</div><div><span class="section-label">${escapeHtml(categoryLabel(app.category))}</span><h3 style="margin:0 0 7px">${escapeHtml(app.name)}</h3><div class="row"><span class="pill">${app.enabled ? 'ظاهر للعملاء' : 'مخفي'}</span><span class="pill">${app.downloadMode === 'direct' ? 'تحميل مباشر' : 'مصدر رسمي'}</span>${app.featured ? '<span class="pill">مميز</span>' : ''}${app.autoUpdate ? '<span class="pill">تحديث تلقائي</span>' : ''}${autoHidden ? '<span class="pill health-bad">مخفي تلقائيًا</span>' : ''}${app.previousDownloadUrl ? `<span class="pill">نسخة سابقة ${escapeHtml(app.previousVersion || '')}</span>` : ''}<span class="pill">${formatCount(downloadStats.byKey?.['app:' + app.slug]?.downloadCount || 0)} طلب تنزيل</span>${health?.checkedAt ? (health.ok ? '<span class="pill health-good">الرابط سليم</span>' : '<span class="pill health-bad">مشكلة بالرابط</span>') : '<span class="pill">غير مفحوص</span>'}<span class="pill">${escapeHtml(app.architecture || 'Universal')}</span>${app.apkSizeBytes ? `<span class="pill">${formatApkSize(app.apkSizeBytes)}</span>` : ''}<span class="muted">${escapeHtml(app.devices)}</span></div></div></div><div class="row">${app.previousDownloadUrl ? `<form method="post" action="${actionPath('rollback-app')}"><input type="hidden" name="slug" value="${escapeHtml(app.slug)}"><button class="qa" type="submit">رجوع للنسخة السابقة</button></form>` : ''}<form method="post" action="${actionPath('delete-app')}"><input type="hidden" name="slug" value="${escapeHtml(app.slug)}"><button class="danger" type="submit">حذف</button></form></div></div><p class="muted">${escapeHtml(app.description)}</p><details style="margin-top:14px"><summary>تعديل التطبيق</summary><form method="post" action="${actionPath('save-app')}" style="margin-top:14px"><div class="grid"><div><label>المعرّف / الرابط المختصر</label><input name="slug" value="${escapeHtml(app.slug)}" readonly></div><div><label>اسم التطبيق</label><input name="name" value="${escapeHtml(app.name)}" required></div><div><label>القسم</label><select name="category">${categoryOptions(app.category)}</select></div><div><label>الرمز المختصر</label><input name="symbol" value="${escapeHtml(app.symbol)}" maxlength="6" required></div><div><label>رابط الأيقونة HTTPS</label><input type="url" name="iconUrl" value="${escapeHtml(app.iconUrl || '')}" required></div><div><label>الأجهزة</label><input name="devices" value="${escapeHtml(app.devices)}" required></div><div><label>الإصدار (اختياري)</label><input name="version" value="${escapeHtml(app.version)}"></div><div><label>المعمارية</label><input name="architecture" value="${escapeHtml(app.architecture || 'Universal')}" placeholder="Universal / ARM64"></div><div><label>حجم APK بالـ MB</label><input type="number" step="0.01" min="0" name="apkSizeMb" value="${apkSizeInput(app.apkSizeBytes)}" placeholder="25.4"></div><div><label>نوع الزر</label><select name="downloadMode">${modeOptions(app.downloadMode)}</select></div><div><label>ترتيب الظهور</label><input type="number" name="sortOrder" min="0" max="9999" value="${app.sortOrder}"></div><div class="full"><label>رابط التحميل أو المصدر HTTPS</label><input type="url" name="downloadUrl" value="${escapeHtml(app.downloadUrl)}" required><div class="muted" style="font-size:11px;margin-top:6px">إذا كان تحميل APK مباشر، يتم فحص الرابط والتحويلات والحجم تلقائيًا قبل الحفظ.</div></div><div class="full"><label>وصف مختصر</label><textarea name="description" maxlength="240" required>${escapeHtml(app.description)}</textarea></div><div class="full checks"><label><input type="checkbox" name="enabled" value="1"${app.enabled ? ' checked' : ''}> يظهر في صفحة التحميل</label><label><input type="checkbox" name="featured" value="1"${app.featured ? ' checked' : ''}> تطبيق مميز</label><label><input type="checkbox" name="autoUpdate" value="1"${app.autoUpdate ? ' checked' : ''}> تحديث تلقائي من المصدر المدعوم</label></div></div><button style="margin-top:12px" type="submit">حفظ التطبيق</button></form></details><div class="url" style="margin-top:13px">${escapeHtml(app.downloadUrl)}</div></section>`;
  }).join('');

  const healthSummary = healthState.summary || {};
  const rankedApps = [...apps]
    .sort((a, b) =>
      Number(downloadStats.byKey?.['app:' + b.slug]?.downloadCount || 0)
      - Number(downloadStats.byKey?.['app:' + a.slug]?.downloadCount || 0)
    )
    .slice(0, 8);
  const rankedRows = Number(downloadStats.appDownloads || 0) > 0
    ? rankedApps.map(app => {
        const count = Number(downloadStats.byKey?.['app:' + app.slug]?.downloadCount || 0);
        const health = healthState.bySlug?.[app.slug];
        const state = !health?.checkedAt ? 'غير مفحوص' : (health.ok ? 'سليم' : 'مشكلة');
        const stateClass = !health?.checkedAt ? '' : (health.ok ? ' health-good' : ' health-bad');
        return `<div class="metric-row"><strong>${escapeHtml(app.name)}</strong><span class="pill">${formatCount(count)} طلب تنزيل</span><span class="pill${stateClass}">${state}</span></div>`;
      }).join('')
    : '<div class="library-note">عداد التحميلات بدأ من الآن. أول ما تبدأ التحميلات الفعلية تظهر التطبيقات الأكثر تحميلًا هنا.</div>';

  const analyticsBlock = `<section class="card"><span class="section-label">التنزيلات وصحة الروابط</span><div class="top"><div><h2>الإحصائيات وصحة الروابط</h2><p class="muted">هذه أعداد طلبات التنزيل، وتشمل الإعادة والمحاولات غير المكتملة. إحصاء الملفات الكاملة يظهر في لوحة الأجهزة.</p><div class="row" style="margin-top:10px"><span class="pill">الإجمالي ${formatCount(downloadStats.total)}</span><span class="pill">BLOFY ${formatCount(downloadStats.blofyDownloads)}</span><span class="pill">التطبيقات ${formatCount(downloadStats.appDownloads)}</span><span class="pill">روابط سليمة ${formatCount(healthSummary.healthy || 0)}</span>${Number(healthSummary.failed || 0) ? `<span class="pill health-bad">روابط بها مشكلة ${formatCount(healthSummary.failed)}</span>` : ''}<span class="pill">آخر فحص روابط: ${escapeHtml(formatAdminTime(healthState.lastHealthAt))}</span></div></div><div class="row"><form method="post" action="${actionPath('refresh-health')}"><button class="public" type="submit">فحص روابط APK الآن</button></form><form method="post" action="${actionPath('refresh-apps')}"><button type="submit">فحص تحديثات التطبيقات</button></form></div></div><div class="metric-list">${rankedRows}</div></section>`;

  const auditRows = auditEntries.length
    ? auditEntries.map(entry => {
        const details = entry.details || {};
        const versionInfo = details.fromVersion || details.toVersion
          ? `${escapeHtml(details.fromVersion || '—')} → ${escapeHtml(details.toVersion || '—')}`
          : '';
        const who = entry.actor === 'system' ? 'النظام' : 'المشرف';
        return `<div class="metric-row"><strong>${escapeHtml(auditActionLabel(entry.action))}</strong><small>${escapeHtml(entry.slug || '')}${versionInfo ? ` · ${versionInfo}` : ''}</small><small>${who} · ${escapeHtml(formatAdminTime(entry.createdAt))}</small></div>`;
      }).join('')
    : '<div class="library-note">ما فيه عمليات مسجلة إلى الآن.</div>';

  const auditBlock = `<section class="card"><span class="section-label">سجل التغييرات</span><h2>سجل تغييرات مكتبة التطبيقات</h2><p class="muted">آخر عمليات الإدارة والتحديثات التلقائية وصحة الروابط.</p><div class="metric-list">${auditRows}</div></section>`;

  const backupRows = backups.length
    ? backups.map(backup => `<div class="backup-row"><strong>${escapeHtml(backupReasonLabel(backup.reason))}</strong><span class="pill">${backup.appCount} تطبيق</span><small>${escapeHtml(formatAdminTime(backup.createdAt))}</small><form method="post" action="${actionPath('restore-backup')}"><input type="hidden" name="backupId" value="${backup.id}"><button class="qa" type="submit">استعادة</button></form></div>`).join('')
    : '<div class="library-note">ما تم إنشاء نسخة احتياطية حتى الآن. أول تعديل أو تحديث جماعي ينشئها تلقائيًا.</div>';

  const backupBlock = `<section class="card"><span class="section-label">النسخ الاحتياطية</span><div class="top"><div><h2>النسخ الاحتياطية</h2><p class="muted">يحفظ النظام آخر 30 نسخة احتياطية تلقائيًا قبل العمليات المهمة.</p></div><span class="pill">${backups.length} ظاهرة</span></div><div class="metric-list">${backupRows}</div></section>`;

  return shell(`<section class="card hero-card"><div class="top"><div><div class="brand">BLOFY PLAYER · إدارة الإصدارات</div><h1>إدارة الإصدارات</h1><div class="muted">التحديث العام الحالي: <strong class="ok"><span dir="ltr">${escapeHtml(current.versionName)}</span></strong> · رمز الإصدار ${current.versionCode}</div><div class="pipeline"><div class="pipe"><strong>مسودة</strong>إضافة ومراجعة البيانات</div><div class="pipe"><strong>اختبار</strong>فحص النسخة قبل النشر</div><div class="pipe"><strong>عام</strong>اعتمادها كتحديث عام</div></div></div><a class="btn" href="/downloads" target="_blank" rel="noreferrer">فتح صفحة التحميل ↗</a></div>${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}</section><section class="card"><span class="section-label">إصدار جديد</span><h2>إضافة نسخة جديدة</h2><p class="muted">تدخل DRAFT أولًا، ثم QA، ثم PUBLIC، وبعدها فقط يمكن تعيينها كتحديث عام.</p><form method="post" action="${actionPath('save')}"><div class="grid"><div><label>رمز الإصدار</label><input type="number" name="versionCode" min="1" placeholder="2000062" required></div><div><label>اسم الإصدار</label><input name="versionName" placeholder="2.0.0-rc07.51" required></div><div class="full"><label>رابط APK المباشر HTTPS</label><input type="url" name="downloadUrl" placeholder="https://.../app-release.apk" required></div><div><label>Min رمز الإصدار</label><input type="number" name="minSupportedVersionCode" min="1" value="1" required></div><div class="full"><label>ملاحظات الإصدار</label><textarea name="releaseNotes" placeholder="أبرز التغييرات والإصلاحات..."></textarea></div></div><button style="margin-top:12px" type="submit">إضافة كـ DRAFT</button></form></section><section class="card"><span class="section-label">سجل الإصدارات</span><h2>الإصدارات</h2>${blocks}</section><section class="card"><span class="section-label">مكتبة تطبيقات التلفزيون</span><h2>إضافة تطبيق للشاشات والرسيفرات</h2><p class="library-note">هذه المكتبة مستقلة عن إصدارات BLOFY. إضافة أو حذف تطبيق هنا لا يغيّر الإصدار الأساسي ولا رابط تحديث BLOFY.</p><form method="post" action="${actionPath('save-app')}"><div class="grid"><div><label>المعرّف / الرابط المختصر</label><input name="slug" placeholder="example-app" pattern="[a-z0-9-]+" required></div><div><label>اسم التطبيق</label><input name="name" placeholder="اسم التطبيق" required></div><div><label>القسم</label><select name="category">${categoryOptions('media')}</select></div><div><label>الرمز المختصر</label><input name="symbol" placeholder="APP" maxlength="6" required></div><div><label>رابط الأيقونة HTTPS</label><input type="url" name="iconUrl" placeholder="https://.../icon.png" required></div><div><label>الأجهزة</label><input name="devices" value="TV · Box"></div><div><label>الإصدار (اختياري)</label><input name="version" placeholder="مثال 1.2.0"></div><div><label>المعمارية</label><input name="architecture" value="Universal" placeholder="Universal / ARM64"></div><div><label>حجم APK بالـ MB</label><input type="number" step="0.01" min="0" name="apkSizeMb" placeholder="25.4"></div><div><label>نوع الزر</label><select name="downloadMode">${modeOptions('direct')}</select></div><div><label>ترتيب الظهور</label><input type="number" name="sortOrder" min="0" max="9999" value="100"></div><div class="full"><label>رابط التحميل أو المصدر HTTPS</label><input type="url" name="downloadUrl" placeholder="https://.../app.apk" required><div class="muted" style="font-size:11px;margin-top:6px">رابط APK المباشر يُفحص تلقائيًا قبل الإضافة، وإذا توفر حجم الملف نلتقطه تلقائيًا.</div></div><div class="full"><label>وصف مختصر</label><textarea name="description" maxlength="240" placeholder="وش يفيد المستخدم؟" required></textarea></div><div class="full checks"><label><input type="checkbox" name="enabled" value="1" checked> يظهر في صفحة التحميل</label><label><input type="checkbox" name="featured" value="1"> تطبيق مميز</label><label><input type="checkbox" name="autoUpdate" value="1"> تحديث تلقائي إذا كان المصدر مدعومًا</label></div></div><button style="margin-top:12px" type="submit">إضافة التطبيق</button></form></section>${analyticsBlock}${backupBlock}${auditBlock}<section class="card"><span class="section-label">دليل التطبيقات</span><div class="top"><div><h2>التطبيقات المجانية</h2><p class="muted">رتّبها أو اخفها أو غيّر رابطها من هنا.</p><div class="row" style="margin-top:8px"><span class="pill"><span id="admin-visible-count">${apps.length}</span> / ${apps.length} تطبيق</span><span class="pill">آخر فحص: ${escapeHtml(formatAdminTime(updateState.lastRefreshAt))}</span>${updateState.summary?.checked ? `<span class="pill">فحص ${Number(updateState.summary.checked || 0)}</span><span class="pill">تحديث ${Number(updateState.summary.updated || 0)}</span>${Number(updateState.summary.failed || 0) ? `<span class="pill">فشل ${Number(updateState.summary.failed)}</span>` : ''}` : ''}</div></div><form method="post" action="${actionPath('refresh-apps')}"><button class="public" type="submit">فحص تحديثات التطبيقات الآن</button></form></div><div class="admin-app-controls"><input class="admin-search" id="admin-app-search" type="search" placeholder="ابحث باسم التطبيق أو Slug..." autocomplete="off"><div class="admin-filters"><button class="admin-filter active" type="button" data-admin-filter="all">الكل</button><button class="admin-filter" type="button" data-admin-filter="healthy">سليم</button><button class="admin-filter" type="button" data-admin-filter="broken">مشكلة</button><button class="admin-filter" type="button" data-admin-filter="hidden">مخفي</button><button class="admin-filter" type="button" data-admin-filter="auto">تحديث تلقائي</button></div></div>${appBlocks || '<p class="muted">لا توجد تطبيقات بعد.</p>'}</section>`);
}

export async function handleAdminAction(form, action) {
  if (isAction(action, 'save')) {
    const release = await upsertRelease({
      versionCode: form.get('versionCode'),
      versionName: form.get('versionName'),
      downloadUrl: form.get('downloadUrl'),
      releaseNotes: form.get('releaseNotes'),
      minSupportedVersionCode: form.get('minSupportedVersionCode')
    });
    return release.stage === 'draft' ? 'تم حفظ النسخة كمسودة.' : `تم حفظ ${release.versionName}.`;
  }
  if (isAction(action, 'promote')) {
    const release = await promoteRelease(form.get('versionCode'));
    return release.stage === 'qa' ? `تم نقل ${release.versionName} إلى الاختبار.` : `تم اعتماد ${release.versionName} كإصدار عام.`;
  }
  if (isAction(action, 'activate')) {
    const release = await activateRelease(form.get('versionCode'));
    return `تم تعيين ${release.versionName} كتحديث عام.`;
  }
  if (isAction(action, 'delete')) {
    await deleteRelease(form.get('versionCode'));
    return 'تم حذف النسخة.';
  }
  if (isAction(action, 'refresh-health')) {
    const result = await refreshAppHealth({ force: true });
    return `تم فحص ${result.checked || 0} رابط APK · سليم ${result.healthy || 0} · مشكلة ${result.failed || 0}.`;
  }
  if (isAction(action, 'refresh-apps')) {
    const result = await refreshManagedApps({ force: true });
    return `تم فحص ${result.checked || 0} تطبيق · تحديث ${result.updated || 0} · بدون تغيير ${result.unchanged || 0} · فشل ${result.failed || 0}.`;
  }
  if (isAction(action, 'save-app')) {
    const downloadMode = String(form.get('downloadMode') || 'direct');
    let sizeBytes = apkSizeBytes(form.get('apkSizeMb'));
    let inspection = null;
    if (downloadMode === 'direct') {
      inspection = await inspectRemoteApk(form.get('downloadUrl'));
      if (inspection.sizeBytes > 0) sizeBytes = inspection.sizeBytes;
    }
    const app = await upsertApp({
      slug: form.get('slug'),
      name: form.get('name'),
      category: form.get('category'),
      symbol: form.get('symbol'),
      iconUrl: form.get('iconUrl'),
      description: form.get('description'),
      devices: form.get('devices'),
      version: form.get('version'),
      architecture: form.get('architecture'),
      apkSizeBytes: sizeBytes,
      downloadUrl: form.get('downloadUrl'),
      downloadMode,
      sortOrder: form.get('sortOrder'),
      enabled: form.get('enabled') === '1',
      featured: form.get('featured') === '1',
      autoUpdate: form.get('autoUpdate') === '1'
    });
    const verified = inspection ? ` · رابط APK مفحوص${sizeBytes ? ` · ${formatApkSize(sizeBytes)}` : ''}` : '';
    return `تم حفظ التطبيق: ${app.name}${verified}.`;
  }
  if (isAction(action, 'restore-backup')) {
    const restored = await restoreCatalogBackup(form.get('backupId'));
    const health = await refreshAppHealth({ force: true });
    return `تمت استعادة النسخة الاحتياطية #${restored.backupId} · ${restored.appCount} تطبيق · فحص الروابط: سليم ${health.healthy || 0} / مشكلة ${health.failed || 0}.`;
  }
  if (isAction(action, 'rollback-app')) {
    const app = await rollbackApp(form.get('slug'));
    return `تم إرجاع ${app.name} إلى النسخة ${app.version || 'السابقة'} بعد فحص رابط APK.`;
  }
  if (isAction(action, 'delete-app')) {
    await deleteApp(form.get('slug'));
    return 'تم حذف التطبيق من المكتبة.';
  }
  throw new Error('unknown_admin_action');
}
