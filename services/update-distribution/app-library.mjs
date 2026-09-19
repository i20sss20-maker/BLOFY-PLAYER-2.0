// Managed TV app library.
import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined
});

const CATEGORIES = new Set(['media', 'files', 'downloads', 'network', 'launcher']);
const MODES = new Set(['official', 'direct']);

const DEFAULT_APPS = Object.freeze([
  { slug:'vlc', name:'VLC', category:'media', symbol:'VLC', description:'مشغل وسائط معروف وخفيف لتشغيل الفيديو والصوت والملفات المحلية والشبكية على Android TV.', devices:'TV · Box · Mobile', downloadUrl:'https://www.videolan.org/vlc/download-android.html', downloadMode:'official', sortOrder:10, enabled:true, featured:false },
  { slug:'kodi', name:'Kodi', category:'media', symbol:'K', description:'مركز وسائط متكامل للشاشات والرسيفرات لتنظيم وتشغيل مكتبتك المحلية والمنزلية.', devices:'TV · Box', downloadUrl:'https://kodi.tv/download/android/', downloadMode:'official', sortOrder:20, enabled:true, featured:false },
  { slug:'just-player', name:'Just Player', category:'media', symbol:'JP', description:'مشغل فيديو بسيط وخفيف مناسب للتلفزيون ويدعم صيغ بث وفيديو حديثة.', devices:'TV · Box · Mobile', downloadUrl:'https://github.com/moneytoo/Player/releases/latest', downloadMode:'official', sortOrder:30, enabled:true, featured:false },
  { slug:'send-files-to-tv', name:'Send Files to TV', category:'files', symbol:'SFTV', description:'إرسال ملفات وملفات APK بين الجوال والتلفزيون على نفس الشبكة بسهولة.', devices:'TV · Box · Mobile', downloadUrl:'https://sendfilestotv.app/', downloadMode:'official', sortOrder:10, enabled:true, featured:false },
  { slug:'x-plore', name:'X-plore File Manager', category:'files', symbol:'XP', description:'مدير ملفات قوي للتلفزيون يدعم USB والشبكة وSMB وFTP وخدمات التخزين.', devices:'TV · Box · Mobile', downloadUrl:'https://www.lonelycatgames.com/apps/xplore', downloadMode:'official', sortOrder:20, enabled:true, featured:false },
  { slug:'anexplorer', name:'AnExplorer', category:'files', symbol:'AE', description:'مدير ملفات مناسب لـ Android TV مع دعم التخزين المحلي والشبكي وملفات APK.', devices:'TV · Box · Mobile', downloadUrl:'https://play.google.com/store/apps/details?id=dev.dworks.apps.anexplorer', downloadMode:'official', sortOrder:30, enabled:true, featured:false },
  { slug:'downloader', name:'Downloader', category:'downloads', symbol:'↓', description:'أداة تنزيل وفتح الروابط على أجهزة Android TV والرسيفرات، مناسبة لتثبيت التطبيقات.', devices:'TV · Box', downloadUrl:'https://www.aftvnews.com/downloader/', downloadMode:'official', sortOrder:10, enabled:true, featured:true },
  { slug:'tv-bro', name:'TV Bro', category:'downloads', symbol:'TB', description:'متصفح ويب مصمم للاستخدام بالريموت على التلفزيون مع أدوات تنزيل وتصفح بسيطة.', devices:'TV · Box', downloadUrl:'https://github.com/truefedex/tv-bro/releases/latest', downloadMode:'official', sortOrder:20, enabled:true, featured:false },
  { slug:'analiti', name:'analiti', category:'network', symbol:'NET', description:'أداة لفحص سرعة الإنترنت والـ Wi-Fi والبنق وجودة الشبكة من الشاشة أو الرسيفر.', devices:'TV · Box · Mobile', downloadUrl:'https://analiti.com/', downloadMode:'official', sortOrder:10, enabled:true, featured:false },
  { slug:'flauncher', name:'FLauncher', category:'launcher', symbol:'FL', description:'واجهة Home بديلة بسيطة للشاشات وأجهزة Android TV لمن يفضّل ترتيبًا أنظف للتطبيقات.', devices:'TV · Box', downloadUrl:'https://play.google.com/store/apps/details?id=me.efesser.flauncher', downloadMode:'official', sortOrder:10, enabled:true, featured:false }
]);

function text(value, max, required = true) {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) throw new Error('invalid_app_text');
  return result;
}

function flag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function httpsUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('invalid_app_url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('invalid_app_url');
  return parsed.toString();
}

function cleanApp(raw) {
  const slug = text(raw.slug, 48).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('invalid_app_slug');
  const category = String(raw.category || '').trim().toLowerCase();
  const downloadMode = String(raw.downloadMode || 'official').trim().toLowerCase();
  const sortOrder = Number(raw.sortOrder ?? 100);
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
    downloadUrl: httpsUrl(raw.downloadUrl),
    downloadMode,
    sortOrder,
    enabled: flag(raw.enabled),
    featured: flag(raw.featured)
  };
}

const mapRow = row => ({
  slug: row.slug,
  name: row.name,
  category: row.category,
  symbol: row.symbol,
  description: row.description,
  devices: row.devices,
  version: row.version || '',
  downloadUrl: row.download_url,
  downloadMode: row.download_mode,
  sortOrder: Number(row.sort_order),
  enabled: row.enabled === true,
  featured: row.featured === true,
  updatedAt: new Date(row.updated_at).getTime()
});

export async function initAppLibrary() {
  await pool.query(`
    create table if not exists blofy_app_catalog (
      slug text primary key,
      name text not null,
      category text not null,
      symbol text not null,
      description text not null,
      devices text not null,
      version text not null default '',
      download_url text not null,
      download_mode text not null check (download_mode in ('official','direct')),
      sort_order integer not null default 100,
      enabled boolean not null default true,
      featured boolean not null default false,
      updated_at timestamptz not null default now()
    )
  `);
  for (const seed of DEFAULT_APPS) {
    const item = cleanApp(seed);
    await pool.query(
      `insert into blofy_app_catalog
       (slug,name,category,symbol,description,devices,version,download_url,download_mode,sort_order,enabled,featured)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict(slug) do nothing`,
      [item.slug,item.name,item.category,item.symbol,item.description,item.devices,item.version,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured]
    );
  }
}

export async function listApps(includeDisabled = false) {
  const result = await pool.query(
    `select * from blofy_app_catalog
     ${includeDisabled ? '' : 'where enabled=true'}
     order by featured desc, category asc, sort_order asc, name asc
     limit 200`
  );
  return result.rows.map(mapRow);
}

export async function getApp(slug, includeDisabled = false) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) return null;
  const result = await pool.query(
    `select * from blofy_app_catalog where slug=$1 ${includeDisabled ? '' : 'and enabled=true'} limit 1`,
    [cleanSlug]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function upsertApp(raw) {
  const item = cleanApp(raw);
  const count = await pool.query('select count(*)::int as n from blofy_app_catalog');
  const exists = await pool.query('select 1 from blofy_app_catalog where slug=$1', [item.slug]);
  if (!exists.rowCount && count.rows[0].n >= 200) throw new Error('app_catalog_full');
  const result = await pool.query(
    `insert into blofy_app_catalog
     (slug,name,category,symbol,description,devices,version,download_url,download_mode,sort_order,enabled,featured,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     on conflict(slug) do update set
       name=excluded.name, category=excluded.category, symbol=excluded.symbol,
       description=excluded.description, devices=excluded.devices, version=excluded.version,
       download_url=excluded.download_url, download_mode=excluded.download_mode,
       sort_order=excluded.sort_order, enabled=excluded.enabled, featured=excluded.featured, updated_at=now()
     returning *`,
    [item.slug,item.name,item.category,item.symbol,item.description,item.devices,item.version,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured]
  );
  return mapRow(result.rows[0]);
}

export async function deleteApp(slug) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) throw new Error('invalid_app_slug');
  const result = await pool.query('delete from blofy_app_catalog where slug=$1 returning slug', [cleanSlug]);
  if (!result.rowCount) throw new Error('app_not_found');
}

export async function closeAppLibrary() {
  await pool.end();
}
