// Managed TV app library for the Azure download center.
import pg from 'pg';
import dns from 'node:dns/promises';
import net from 'node:net';

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

const CATEGORIES = new Set(['media', 'files', 'downloads', 'launcher', 'screensaver', 'tools', 'network']);
const MODES = new Set(['official', 'direct']);
const SEED_VERSION = 4;

const DEFAULT_APPS = Object.freeze([
  {
    slug:'vlc', name:'VLC', category:'media', symbol:'VLC',
    iconUrl:'https://raw.githubusercontent.com/videolan/vlc-android/master/application/resources/src/main/res/drawable-xxxhdpi/icon.png',
    description:'مشغل فيديو وصوت خفيف وموثوق للشاشات والرسيفرات.',
    devices:'Android TV · Box · ARM64', version:'3.7.0',
    architecture:'ARM64', apkSizeBytes:0,
    downloadUrl:'https://get.videolan.org/vlc-android/3.7.0/VLC-Android-3.7.0-arm64-v8a.apk',
    downloadMode:'direct', sortOrder:10, enabled:true, featured:true
  },
  {
    slug:'kodi', name:'Kodi', category:'media', symbol:'K',
    iconUrl:'https://raw.githubusercontent.com/xbmc/xbmc/master/media/icon256x256.png',
    description:'مركز وسائط متكامل لتشغيل وتنظيم مكتبة الأفلام والفيديو على التلفزيون.',
    devices:'Android TV · Box · ARM64', version:'21.3',
    architecture:'ARM64', apkSizeBytes:0,
    downloadUrl:'https://mirrors.kodi.tv/releases/android/arm64-v8a/kodi-21.3-Omega-arm64-v8a.apk',
    downloadMode:'direct', sortOrder:20, enabled:true, featured:false
  },
  {
    slug:'just-player', name:'Just Player', category:'media', symbol:'JP',
    iconUrl:'https://raw.githubusercontent.com/moneytoo/Player/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'مشغل فيديو بسيط وسريع مناسب للريموت وملفات الفيديو الحديثة.',
    devices:'Android TV · Box · Mobile', version:'0.216',
    architecture:'Universal', apkSizeBytes:51014578,
    downloadUrl:'https://github.com/moneytoo/Player/releases/download/v0.216/Just.Player.v0.216.apk',
    downloadMode:'direct', sortOrder:30, enabled:true, featured:false
  },
  {
    slug:'nova-player', name:'NOVA Video Player', category:'media', symbol:'N',
    iconUrl:'https://raw.githubusercontent.com/nova-video-player/aos-AVP/nova/fastlane/metadata/android/en-US/images/icon.png',
    description:'مشغل ومكتبة فيديو ممتازة للشاشات مع دعم الشبكة وSMB والترجمات.',
    devices:'Android TV · Box · Universal', version:'6.4.64',
    architecture:'Universal', apkSizeBytes:84398344,
    downloadUrl:'https://github.com/nova-video-player/aos-AVP/releases/download/v6.4.64/org.courville.nova-2669737-6.4.64-20260912.1301-universal-release.apk',
    downloadMode:'direct', sortOrder:40, enabled:true, featured:false
  },
  {
    slug:'tv-bro', name:'TV Bro', category:'downloads', symbol:'TB',
    iconUrl:'https://raw.githubusercontent.com/truefedex/tv-bro/master/app/src/main/res/drawable-xhdpi/ic_launcher.png',
    description:'متصفح مصمم للريموت على Android TV مع تنزيل ملفات وروابط بسهولة.',
    devices:'Android TV · Box', version:'2.1.6',
    architecture:'Universal', apkSizeBytes:6790605,
    downloadUrl:'https://github.com/truefedex/tv-bro/releases/download/v2.1.6/tvbro-2.1.6-generic-geckoExcluded.apk',
    downloadMode:'direct', sortOrder:50, enabled:true, featured:false
  },
  {
    slug:'amaze', name:'Amaze File Manager', category:'files', symbol:'AF',
    iconUrl:'https://raw.githubusercontent.com/TeamAmaze/AmazeFileManager/master/icon.png',
    description:'مدير ملفات مفتوح المصدر لإدارة الملفات وملفات APK والتخزين.',
    devices:'Android · TV/Box compatible', version:'3.11.3',
    architecture:'Universal', apkSizeBytes:12311594,
    downloadUrl:'https://github.com/TeamAmaze/AmazeFileManager/releases/download/v3.11.3/app-fdroid-release.apk',
    downloadMode:'direct', sortOrder:60, enabled:true, featured:false
  },
  {
    slug:'jellyfin-tv', name:'Jellyfin for Android TV', category:'media', symbol:'JF',
    iconUrl:'https://raw.githubusercontent.com/jellyfin/jellyfin-androidtv/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'عميل Jellyfin الرسمي للشاشات لتشغيل مكتبتك المنزلية من السيرفر.',
    devices:'Android TV · Box', version:'0.19.10',
    architecture:'Universal', apkSizeBytes:21950619,
    downloadUrl:'https://github.com/jellyfin/jellyfin-androidtv/releases/download/v0.19.10/jellyfin-androidtv-v0.19.10-release.apk',
    downloadMode:'direct', sortOrder:70, enabled:true, featured:false
  },
  {
    slug:'ltv-launcher', name:'LTvLauncher', category:'launcher', symbol:'LT',
    iconUrl:'https://raw.githubusercontent.com/leanbitlab-org/LtvLauncher/master/assets/icon.png',
    description:'واجهة Home خفيفة ومفتوحة المصدر لترتيب تطبيقات Android TV وFire TV.',
    devices:'Android TV · Fire TV · Universal', version:'2026.09.15',
    architecture:'Universal', apkSizeBytes:18387553,
    downloadUrl:'https://github.com/leanbitlab-org/LtvLauncher/releases/download/v2026.09.15/LTvLauncher-universal-release.apk',
    downloadMode:'direct', sortOrder:80, enabled:true, featured:false
  },
  {
    slug:'aerial-views', name:'Aerial Views', category:'screensaver', symbol:'AV',
    iconUrl:'https://raw.githubusercontent.com/theothernt/AerialViews/master/app/src/main/ic_launcher-playstore.png',
    description:'شاشة توقف 4K للشاشات وGoogle TV وNVIDIA Shield وFire TV.',
    devices:'Android TV · Google TV · Fire TV', version:'1.8.4',
    architecture:'Universal', apkSizeBytes:8776119,
    downloadUrl:'https://github.com/theothernt/AerialViews/releases/download/1.8.4/aerial-views-1.8.4.apk',
    downloadMode:'direct', sortOrder:90, enabled:true, featured:false
  },
  {
    slug:'localsend', name:'LocalSend', category:'files', symbol:'LS',
    iconUrl:'https://raw.githubusercontent.com/localsend/localsend/main/app/android/app/src/main/ic_launcher-playstore.png',
    description:'إرسال ملفات وملفات APK بين الجوال والكمبيوتر والشاشة على نفس الشبكة بدون حساب.',
    devices:'Android · TV/Box · ARM64', version:'1.18.2',
    architecture:'ARM64', apkSizeBytes:46558706,
    downloadUrl:'https://github.com/localsend/localsend/releases/download/v1.18.2/LocalSend-1.18.2-android-arm64v8.apk',
    downloadMode:'direct', sortOrder:100, enabled:true, featured:true
  },
  {
    slug:'mpv-android', name:'mpv-android', category:'media', symbol:'MPV',
    iconUrl:'https://raw.githubusercontent.com/mpv-android/mpv-android/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'مشغل فيديو قوي وخفيف يدعم صيغ كثيرة وتسريع العتاد والترجمات.',
    devices:'Android TV · Box · ARM64', version:'2026-09-17',
    architecture:'ARM64', apkSizeBytes:34290346,
    downloadUrl:'https://github.com/mpv-android/mpv-android/releases/download/2026-09-17/app-default-arm64-v8a-release.apk',
    downloadMode:'direct', sortOrder:110, enabled:true, featured:false
  },
  {
    slug:'moonlight', name:'Moonlight', category:'media', symbol:'ML',
    iconUrl:'https://raw.githubusercontent.com/moonlight-stream/moonlight-android/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'بث ألعاب الكمبيوتر إلى التلفزيون أو Android Box بجودة عالية وزمن استجابة منخفض.',
    devices:'Android TV · Box · Gamepad', version:'12.2',
    architecture:'Universal', apkSizeBytes:11137885,
    downloadUrl:'https://github.com/moonlight-stream/moonlight-android/releases/download/v12.2/app-nonRoot-release.apk',
    downloadMode:'direct', sortOrder:120, enabled:true, featured:false
  },
  {
    slug:'material-files', name:'Material Files', category:'files', symbol:'MF',
    iconUrl:'https://raw.githubusercontent.com/zhanghai/MaterialFiles/master/app/src/main/res/mipmap-xxxhdpi/launcher_icon.png',
    description:'مدير ملفات مفتوح المصدر لإدارة التخزين والملفات والأرشيفات وFTP.',
    devices:'Android · TV/Box compatible', version:'1.7.4',
    architecture:'Universal', apkSizeBytes:12117315,
    downloadUrl:'https://github.com/zhanghai/MaterialFiles/releases/download/v1.7.4/app-release-universal.apk',
    downloadMode:'direct', sortOrder:130, enabled:true, featured:false
  },
  {
    slug:'rustdesk', name:'RustDesk', category:'tools', symbol:'RD',
    iconUrl:'https://raw.githubusercontent.com/rustdesk/rustdesk/master/fastlane/metadata/android/en-US/images/icon.png',
    description:'أداة دعم وتحكم عن بعد مفيدة لصيانة أجهزة Android والبوكسات من جهاز آخر.',
    devices:'Android · ARM64', version:'1.4.9',
    architecture:'ARM64', apkSizeBytes:26871021,
    downloadUrl:'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-aarch64-signed.apk',
    downloadMode:'direct', sortOrder:140, enabled:true, featured:false
  },
  {
    slug:'obtainium', name:'Obtainium', category:'tools', symbol:'OB',
    iconUrl:'https://raw.githubusercontent.com/ImranR98/Obtainium/main/assets/graphics/icon-512x512.png',
    description:'يتابع تحديثات التطبيقات من مصادرها الأصلية مثل GitHub ويثبت الإصدارات الجديدة بسهولة.',
    devices:'Android TV · Box · Mobile', version:'1.6.17',
    architecture:'Universal', apkSizeBytes:72251016,
    downloadUrl:'https://github.com/ImranR98/Obtainium/releases/download/v1.6.17/app-release.apk',
    downloadMode:'direct', sortOrder:150, enabled:true, featured:true
  },
  {
    slug:'app-manager', name:'App Manager', category:'tools', symbol:'AM',
    iconUrl:'https://raw.githubusercontent.com/MuntashirAkon/AppManager/master/app/src/main/ic_launcher-playstore.png',
    description:'إدارة التطبيقات المثبتة والحزم والنسخ الاحتياطي ومعلومات APK على أجهزة Android.',
    devices:'Android TV · Box · Mobile', version:'4.1.1',
    architecture:'Universal', apkSizeBytes:28270163,
    downloadUrl:'https://github.com/MuntashirAkon/AppManager/releases/download/v4.1.1/AppManager_v4.1.1.apk',
    downloadMode:'direct', sortOrder:160, enabled:true, featured:false
  },
  {
    slug:'next-player', name:'Next Player', category:'media', symbol:'NP',
    iconUrl:'https://raw.githubusercontent.com/anilbeesetti/nextplayer/main/app/src/main/ic_launcher-playstore.png',
    description:'مشغل فيديو حديث يدعم Android TV والريموت والترجمات ومجموعة واسعة من الصيغ.',
    devices:'Android TV · Box · Mobile', version:'0.18.0',
    architecture:'Universal', apkSizeBytes:54428199,
    downloadUrl:'https://github.com/anilbeesetti/nextplayer/releases/download/v0.18.0/nextplayer-v0.18.0-universal.apk',
    downloadMode:'direct', sortOrder:170, enabled:true, featured:false
  },
  {
    slug:'fossify-file-manager', name:'Fossify File Manager', category:'files', symbol:'FF',
    iconUrl:'https://raw.githubusercontent.com/FossifyOrg/File-Manager/main/app/src/main/ic_launcher-playstore.png',
    description:'مدير ملفات بسيط ومفتوح المصدر للتصفح والنقل والضغط وفك الضغط وإدارة التخزين.',
    devices:'Android · Box', version:'1.6.1',
    architecture:'Universal', apkSizeBytes:9982225,
    downloadUrl:'https://github.com/FossifyOrg/File-Manager/releases/download/1.6.1/file-manager-13-foss-release.apk',
    downloadMode:'direct', sortOrder:180, enabled:true, featured:false
  },
  {
    slug:'wifi-analyzer', name:'WiFi Analyzer', category:'network', symbol:'WF',
    iconUrl:'https://raw.githubusercontent.com/VREMSoftwareDevelopment/WiFiAnalyzer/main/images/icon.png',
    description:'تحليل قنوات Wi‑Fi وقوة الإشارة والازدحام للمساعدة في تحسين اتصال الشاشة أو الرسيفر.',
    devices:'Android · Box', version:'3.3.1',
    architecture:'Universal', apkSizeBytes:2080508,
    downloadUrl:'https://github.com/VREMSoftwareDevelopment/WiFiAnalyzer/releases/download/V3.3.1-F-DROID/WiFiAnalyzer-3.3.1.apk',
    downloadMode:'direct', sortOrder:190, enabled:true, featured:false
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

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] === 0;
  }
  if (net.isIP(address) === 6) {
    const clean = address.toLowerCase();
    return clean === '::1' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:');
  }
  return true;
}

async function assertPublicHttpsTarget(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === 'metadata.google.internal') {
    throw new Error('apk_host_not_public');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('apk_host_not_public');
    return;
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) {
    throw new Error('apk_host_not_public');
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'BLOFY-Download-Center/1.0',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectRemoteApk(value) {
  const requestedUrl = httpsUrl(value);
  if (!/\.apk$/i.test(new URL(requestedUrl).pathname)) throw new Error('direct_download_must_be_apk');
  await assertPublicHttpsTarget(requestedUrl);

  let response;
  try {
    response = await fetchWithTimeout(requestedUrl, { method: 'HEAD' });
    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(requestedUrl, {
        method: 'GET',
        headers: { range: 'bytes=0-0' }
      });
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('apk_check_timeout');
    throw new Error('apk_check_failed');
  }

  if (!response.ok && response.status !== 206) throw new Error(`apk_http_${response.status}`);
  const finalUrl = httpsUrl(response.url || requestedUrl);
  await assertPublicHttpsTarget(finalUrl);
  if (!/\.apk$/i.test(new URL(finalUrl).pathname)) throw new Error('apk_redirect_not_apk');

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const rawLength = Number(response.headers.get('content-length') || 0);
  const contentRange = String(response.headers.get('content-range') || '');
  const rangeMatch = contentRange.match(/\/(\d+)$/);
  const sizeBytes = rangeMatch ? Number(rangeMatch[1]) : (Number.isFinite(rawLength) ? rawLength : 0);

  if (contentType && !(
    contentType.includes('android.package-archive')
    || contentType.includes('application/octet-stream')
    || contentType.includes('binary/octet-stream')
  )) {
    throw new Error('apk_unexpected_content_type');
  }

  return {
    requestedUrl,
    finalUrl,
    status: response.status,
    contentType,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.floor(sizeBytes) : 0,
    checkedAt: Date.now()
  };
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
    architecture: text(raw.architecture || 'Universal', 32),
    apkSizeBytes: Math.max(0, Math.floor(Number(raw.apkSizeBytes || 0) || 0)),
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
  architecture: row.architecture || '',
  apkSizeBytes: Number(row.apk_size_bytes || 0),
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
     (slug,name,category,symbol,icon_url,description,devices,version,architecture,apk_size_bytes,download_url,download_mode,sort_order,enabled,featured,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
     on conflict(slug) do nothing`,
    [item.slug,item.name,item.category,item.symbol,item.iconUrl,item.description,item.devices,item.version,item.architecture,item.apkSizeBytes,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured]
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
        architecture text not null default '',
        apk_size_bytes bigint not null default 0,
        download_url text not null,
        download_mode text not null check (download_mode in ('official','direct')),
        sort_order integer not null default 100,
        enabled boolean not null default true,
        featured boolean not null default false,
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("alter table blofy_app_catalog add column if not exists icon_url text not null default ''");
    await client.query("alter table blofy_app_catalog add column if not exists architecture text not null default ''");
    await client.query("alter table blofy_app_catalog add column if not exists apk_size_bytes bigint not null default 0");
    await client.query(`
      create table if not exists blofy_app_catalog_meta (
        id smallint primary key check(id=1),
        seed_version integer not null default 0
      )
    `);
    await client.query('insert into blofy_app_catalog_meta(id,seed_version) values(1,0) on conflict(id) do nothing');
    const version = Number((await client.query('select seed_version from blofy_app_catalog_meta where id=1 for update')).rows[0]?.seed_version || 0);

    if (version < SEED_VERSION) {
      for (const seed of DEFAULT_APPS) {
        const item = cleanApp(seed);
        await insertSeed(client, item);
        await client.query(
          'update blofy_app_catalog set architecture=$2, apk_size_bytes=$3 where slug=$1',
          [item.slug, item.architecture, item.apkSizeBytes]
        );
      }
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
     (slug,name,category,symbol,icon_url,description,devices,version,architecture,apk_size_bytes,download_url,download_mode,sort_order,enabled,featured,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
     on conflict(slug) do update set
       name=excluded.name, category=excluded.category, symbol=excluded.symbol, icon_url=excluded.icon_url,
       description=excluded.description, devices=excluded.devices, version=excluded.version,
       architecture=excluded.architecture, apk_size_bytes=excluded.apk_size_bytes,
       download_url=excluded.download_url, download_mode=excluded.download_mode,
       sort_order=excluded.sort_order, enabled=excluded.enabled, featured=excluded.featured, updated_at=now()
     returning *`,
    [item.slug,item.name,item.category,item.symbol,item.iconUrl,item.description,item.devices,item.version,item.architecture,item.apkSizeBytes,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured]
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
