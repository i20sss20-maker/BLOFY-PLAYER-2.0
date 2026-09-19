// Managed TV app library for the Azure download center.
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

const CATEGORIES = new Set(['media', 'files', 'downloads', 'launcher', 'screensaver']);
const MODES = new Set(['official', 'direct']);
const SEED_VERSION = 2;

const DEFAULT_APPS = Object.freeze([
  {
    slug:'vlc', name:'VLC', category:'media', symbol:'VLC',
    iconUrl:'https://cdn.simpleicons.org/vlcmediaplayer',
    description:'مشغل فيديو وصوت خفيف وموثوق للشاشات والرسيفرات.',
    devices:'Android TV · Box · ARM64', version:'3.7.0',
    downloadUrl:'https://get.videolan.org/vlc-android/3.7.0/VLC-Android-3.7.0-arm64-v8a.apk',
    downloadMode:'direct', sortOrder:10, enabled:true, featured:true
  },
  {
    slug:'kodi', name:'Kodi', category:'media', symbol:'K',
    iconUrl:'https://cdn.simpleicons.org/kodi',
    description:'مركز وسائط متكامل لتشغيل وتنظيم مكتبة الأفلام والفيديو على التلفزيون.',
    devices:'Android TV · Box · ARM64', version:'21.3',
    downloadUrl:'https://mirrors.kodi.tv/releases/android/arm64-v8a/kodi-21.3-Omega-arm64-v8a.apk',
    downloadMode:'direct', sortOrder:20, enabled:true, featured:false
  },
  {
    slug:'just-player', name:'Just Player', category:'media', symbol:'JP',
    iconUrl:'https://raw.githubusercontent.com/moneytoo/Player/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'مشغل فيديو بسيط وسريع مناسب للريموت وملفات الفيديو الحديثة.',
    devices:'Android TV · Box · Mobile', version:'0.216',
    downloadUrl:'https://github.com/moneytoo/Player/releases/download/v0.216/Just.Player.v0.216.apk',
    downloadMode:'direct', sortOrder:30, enabled:true, featured:false
  },
  {
    slug:'nova-player', name:'NOVA Video Player', category:'media', symbol:'N',
    iconUrl:'https://raw.githubusercontent.com/nova-video-player/aos-AVP/nova/fastlane/metadata/android/en-US/images/icon.png',
    description:'مشغل ومكتبة فيديو ممتازة للشاشات مع دعم الشبكة وSMB والترجمات.',
    devices:'Android TV · Box · Universal', version:'6.4.64',
    downloadUrl:'https://github.com/nova-video-player/aos-AVP/releases/download/v6.4.64/org.courville.nova-2669737-6.4.64-20260912.1301-universal-release.apk',
    downloadMode:'direct', sortOrder:40, enabled:true, featured:false
  },
  {
    slug:'tv-bro', name:'TV Bro', category:'downloads', symbol:'TB',
    iconUrl:'https://raw.githubusercontent.com/truefedex/tv-bro/master/app/src/main/res/drawable-xhdpi/ic_launcher.png',
    description:'متصفح مصمم للريموت على Android TV مع تنزيل ملفات وروابط بسهولة.',
    devices:'Android TV · Box', version:'2.1.6',
    downloadUrl:'https://github.com/truefedex/tv-bro/releases/download/v2.1.6/tvbro-2.1.6-generic-geckoExcluded.apk',
    downloadMode:'direct', sortOrder:50, enabled:true, featured:false
  },
  {
    slug:'amaze', name:'Amaze File Manager', category:'files', symbol:'AF',
    iconUrl:'https://raw.githubusercontent.com/TeamAmaze/AmazeFileManager/master/icon.png',
    description:'مدير ملفات مفتوح المصدر لإدارة الملفات وملفات APK والتخزين.',
    devices:'Android · TV/Box compatible', version:'3.11.3',
    downloadUrl:'https://github.com/TeamAmaze/AmazeFileManager/releases/download/v3.11.3/app-fdroid-release.apk',
    downloadMode:'direct', sortOrder:60, enabled:true, featured:false
  },
  {
    slug:'jellyfin-tv', name:'Jellyfin for Android TV', category:'media', symbol:'JF',
    iconUrl:'https://raw.githubusercontent.com/jellyfin/jellyfin-androidtv/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'عميل Jellyfin الرسمي للشاشات لتشغيل مكتبتك المنزلية من السيرفر.',
    devices:'Android TV · Box', version:'0.19.10',
    downloadUrl:'https://github.com/jellyfin/jellyfin-androidtv/releases/download/v0.19.10/jellyfin-androidtv-v0.19.10-release.apk',
    downloadMode:'direct', sortOrder:70, enabled:true, featured:false
  },
  {
    slug:'ltv-launcher', name:'LTvLauncher', category:'launcher', symbol:'LT',
    iconUrl:'https://raw.githubusercontent.com/leanbitlab-org/LtvLauncher/master/assets/icon.png',
    description:'واجهة Home خفيفة ومفتوحة المصدر لترتيب تطبيقات Android TV وFire TV.',
    devices:'Android TV · Fire TV · Universal', version:'2026.09.15',
    downloadUrl:'https://github.com/leanbitlab-org/LtvLauncher/releases/download/v2026.09.15/LTvLauncher-universal-release.apk',
    downloadMode:'direct', sortOrder:80, enabled:true, featured:false
  },
  {
    slug:'aerial-views', name:'Aerial Views', category:'screensaver', symbol:'AV',
    iconUrl:'https://raw.githubusercontent.com/theothernt/AerialViews/master/app/src/main/ic_launcher-playstore.png',
    description:'شاشة توقف 4K للشاشات وGoogle TV وNVIDIA Shield وFire TV.',
    devices:'Android TV · Google TV · Fire TV', version:'1.8.4',
    downloadUrl:'https://github.com/theothernt/AerialViews/releases/download/1.8.4/aerial-views-1.8.4.apk',
    downloadMode:'direct', sortOrder:90, enabled:true, featured:false
  }
]);

function text(value, max, required = true) {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) throw new Error('invalid_app_text');
  return result;
}

function flag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function httpsUrl(value, code = 'invalid_app_url') {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error(code); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error(code);
  return parsed.toString();
}

function cleanApp(raw) {
  const slug = text(raw.slug, 48).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('invalid_app_slug');
  const category = String(raw.category || '').trim().toLowerCase();
  const downloadMode = String(raw.downloadMode || 'direct').trim().toLowerCase();
  const sortOrder = Number(raw.sortOrder ?? 100);
  if (!CATEGORIES.has(category)) throw new Error('invalid_app_category');
  if (!MODES.has(downloadMode)) throw new Error('invalid_app_download_mode');
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new Error('invalid_app_sort_order');
  const downloadUrl = httpsUrl(raw.downloadUrl);
  if (downloadMode === 'direct' && !/\.apk$/i.test(new URL(downloadUrl).pathname)) throw new Error('direct_download_must_be_apk');
  return {
    slug,
    name: text(raw.name, 64),
    category,
    symbol: text(raw.symbol || raw.name?.slice(0, 2), 6),
    iconUrl: httpsUrl(raw.iconUrl, 'invalid_icon_url'),
    description: text(raw.description, 240),
    devices: text(raw.devices || 'TV · Box', 80),
    version: text(raw.version, 40, false),
    downloadUrl,
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
  iconUrl: row.icon_url || '',
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

async function insertSeed(client, item) {
  await client.query(
    `insert into blofy_app_catalog
     (slug,name,category,symbol,icon_url,description,devices,version,download_url,download_mode,sort_order,enabled,featured,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     on conflict(slug) do nothing`,
    [item.slug,item.name,item.category,item.symbol,item.iconUrl,item.description,item.devices,item.version,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured]
  );
}

export async function initAppLibrary() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      create table if not exists blofy_app_catalog (
        slug text primary key,
        name text not null,
        category text not null,
        symbol text not null,
        icon_url text not null default '',
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
    await client.query("alter table blofy_app_catalog add column if not exists icon_url text not null default ''");
    await client.query(`
      create table if not exists blofy_app_catalog_meta (
        id smallint primary key check(id=1),
        seed_version integer not null default 0
      )
    `);
    await client.query('insert into blofy_app_catalog_meta(id,seed_version) values(1,0) on conflict(id) do nothing');
    const version = Number((await client.query('select seed_version from blofy_app_catalog_meta where id=1 for update')).rows[0]?.seed_version || 0);

    if (version < SEED_VERSION) {
      await client.query('delete from blofy_app_catalog');
      for (const seed of DEFAULT_APPS) await insertSeed(client, cleanApp(seed));
      await client.query('update blofy_app_catalog_meta set seed_version=$1 where id=1', [SEED_VERSION]);
    } else {
      for (const seed of DEFAULT_APPS) await insertSeed(client, cleanApp(seed));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listApps(includeDisabled = false) {
  const result = await pool.query(
    `select * from blofy_app_catalog
     ${includeDisabled ? '' : 'where enabled=true'}
     order by featured desc, sort_order asc, name asc
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
     (slug,name,category,symbol,icon_url,description,devices,version,download_url,download_mode,sort_order,enabled,featured,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     on conflict(slug) do update set
       name=excluded.name, category=excluded.category, symbol=excluded.symbol, icon_url=excluded.icon_url,
       description=excluded.description, devices=excluded.devices, version=excluded.version,
       download_url=excluded.download_url, download_mode=excluded.download_mode,
       sort_order=excluded.sort_order, enabled=excluded.enabled, featured=excluded.featured, updated_at=now()
     returning *`,
    [item.slug,item.name,item.category,item.symbol,item.iconUrl,item.description,item.devices,item.version,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured]
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
