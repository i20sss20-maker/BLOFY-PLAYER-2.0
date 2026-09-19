import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_PATH = process.env.APP_STORE_PATH || '/data/apps.json';
const CATEGORIES = new Set(['media', 'files', 'downloads', 'network', 'launcher']);
const MODES = new Set(['official', 'direct']);

const DEFAULT_APPS = Object.freeze([
  { slug:'vlc', name:'VLC', category:'media', symbol:'VLC', description:'مشغل وسائط معروف وخفيف لتشغيل الفيديو والصوت والملفات المحلية والشبكية على Android TV.', devices:'TV · Box · Mobile', downloadUrl:'https://www.videolan.org/vlc/download-android.html', downloadMode:'official', sortOrder:10, enabled:true, featured:false },
  { slug:'kodi', name:'Kodi', category:'media', symbol:'K', description:'مركز وسائط متكامل للشاشات والرسيفرات لتنظيم وتشغيل مكتبتك المحلية والمنزلية.', devices:'TV · Box', downloadUrl:'https://kodi.tv/download/android/', downloadMode:'official', sortOrder:20, enabled:true, featured:false },
  { slug:'just-player', name:'Just Player', category:'media', symbol:'JP', description:'مشغل فيديو بسيط وخفيف مناسب للتلفزيون ويدعم صيغ بث وفيديو حديثة.', devices:'TV · Box · Mobile', downloadUrl:'https://github.com/moneytoo/Player/releases/latest', downloadMode:'official', sortOrder:30, enabled:true, featured:false },
  { slug:'send-files-to-tv', name:'Send Files to TV', category:'files', symbol:'SFTV', description:'إرسال ملفات وملفات APK بين الجوال والتلفزيون على نفس الشبكة بسهولة.', devices:'TV · Box · Mobile', downloadUrl:'https://sendfilestotv.app/', downloadMode:'official', sortOrder:10, enabled:true, featured:false },
  { slug:'x-plore', name:'X-plore File Manager', category:'files', symbol:'XP', description:'مدير ملفات قوي للتلفزيون يدعم USB والشبكة وSMB وFTP وخدمات التخزين.', devices:'TV · Box · Mobile', downloadUrl:'https://www.lonelycatgames.com/apps/xplore', downloadMode:'official', sortOrder:20, enabled:true, featured:false },
  { slug:'anexplorer', name:'AnExplorer', category:'files', symbol:'AE', description:'مدير ملفات مناسب لـ Android TV مع دعم التخزين المحلي والشبكي وملفات APK.', devices:'TV · Box · Mobile', downloadUrl:'https://play.google.com/store/apps/details?id=dev.dworks.apps.anexplorer', downloadMode:'official', sortOrder:30, enabled:true, featured:false },
  { slug:'downloader', name:'Downloader', category:'downloads', symbol:'DL', description:'أداة تنزيل وفتح الروابط على أجهزة Android TV والرسيفرات، مناسبة لتثبيت التطبيقات.', devices:'TV · Box', downloadUrl:'https://www.aftvnews.com/downloader/', downloadMode:'official', sortOrder:10, enabled:true, featured:true },
  { slug:'tv-bro', name:'TV Bro', category:'downloads', symbol:'TB', description:'متصفح ويب مصمم للاستخدام بالريموت على التلفزيون مع أدوات تنزيل وتصفح بسيطة.', devices:'TV · Box', downloadUrl:'https://github.com/truefedex/tv-bro/releases/latest', downloadMode:'official', sortOrder:20, enabled:true, featured:false },
  { slug:'analiti', name:'analiti', category:'network', symbol:'NET', description:'أداة لفحص سرعة الإنترنت والـ Wi-Fi والبنق وجودة الشبكة من الشاشة أو الرسيفر.', devices:'TV · Box · Mobile', downloadUrl:'https://analiti.com/', downloadMode:'official', sortOrder:10, enabled:true, featured:false },
  { slug:'flauncher', name:'FLauncher', category:'launcher', symbol:'FL', description:'واجهة Home بديلة بسيطة للشاشات وأجهزة Android TV لمن يفضّل ترتيبًا أنظف للتطبيقات.', devices:'TV · Box', downloadUrl:'https://play.google.com/store/apps/details?id=me.efesser.flauncher', downloadMode:'official', sortOrder:10, enabled:true, featured:false }
]);

let apps = [];
let writeChain = Promise.resolve();

function text(value, max, required = true) {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) throw new Error('invalid_app_text');
  return result;
}

function flag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function safeUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('invalid_app_url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('invalid_app_url');
  return parsed.toString();
}

function cleanApp(raw) {
  const slug = text(raw.slug, 48).toLowerCase();
  const category = String(raw.category || '').trim().toLowerCase();
  const downloadMode = String(raw.downloadMode || 'official').trim().toLowerCase();
  const sortOrder = Number(raw.sortOrder ?? 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('invalid_app_slug');
  if (!CATEGORIES.has(category)) throw new Error('invalid_app_category');
  if (!MODES.has(downloadMode)) throw new Error('invalid_app_download_mode');
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new Error('invalid_app_sort_order');
  return {
    slug,
    name: text(raw.name, 64),
    category,
    symbol: text(raw.symbol || raw.name?.slice(0, 2), 6),
    description: text(raw.description, 240),
    devices: text(raw.devices || 'TV · Box', 64),
    version: text(raw.version, 40, false),
    downloadUrl: safeUrl(raw.downloadUrl),
    downloadMode,
    sortOrder,
    enabled: flag(raw.enabled),
    featured: flag(raw.featured)
  };
}

async function save() {
  const snapshot = JSON.stringify({ apps }, null, 2) + '\n';
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  writeChain = writeChain.then(async () => {
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, snapshot, { encoding:'utf8', mode:0o600 });
    await fs.rename(tmp, STORE_PATH);
  });
  await writeChain;
}

export async function initAppLibrary() {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, 'utf8'));
    const stored = Array.isArray(raw?.apps) ? raw.apps.map(cleanApp) : [];
    apps = stored.length ? stored : DEFAULT_APPS.map(cleanApp);
    if (!stored.length) await save();
  } catch {
    apps = DEFAULT_APPS.map(cleanApp);
    await save();
  }
}

export function listApps(includeDisabled = false) {
  return apps
    .filter(app => includeDisabled || app.enabled)
    .map(app => ({ ...app }))
    .sort((a,b) => Number(b.featured)-Number(a.featured) || a.category.localeCompare(b.category) || a.sortOrder-b.sortOrder || a.name.localeCompare(b.name));
}

export function getApp(slug, includeDisabled = false) {
  const key = String(slug || '').trim().toLowerCase();
  const app = apps.find(item => item.slug === key && (includeDisabled || item.enabled));
  return app ? { ...app } : null;
}

export async function upsertApp(raw) {
  const app = cleanApp(raw);
  const existingIndex = apps.findIndex(item => item.slug === app.slug);
  if (existingIndex < 0 && apps.length >= 200) throw new Error('app_catalog_full');
  if (existingIndex >= 0) apps[existingIndex] = app;
  else apps.push(app);
  await save();
  return { ...app };
}

export async function deleteApp(slug) {
  const key = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw new Error('invalid_app_slug');
  const before = apps.length;
  apps = apps.filter(item => item.slug !== key);
  if (apps.length === before) throw new Error('app_not_found');
  await save();
}
