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

const CATEGORIES = new Set(['media', 'files', 'downloads', 'launcher', 'screensaver', 'tools', 'network', 'store']);
const MODES = new Set(['official', 'direct']);
const SEED_VERSION = 5;

const GITHUB_UPDATE_RULES = Object.freeze({
  'just-player': { repo:'moneytoo/Player', asset:'Just.Player.*.apk' },
  'nova-player': { repo:'nova-video-player/aos-AVP', asset:'*universal-release.apk' },
  'tv-bro': { repo:'truefedex/tv-bro', asset:'*generic-geckoExcluded.apk' },
  'amaze': { repo:'TeamAmaze/AmazeFileManager', asset:'app-fdroid-release.apk' },
  'jellyfin-tv': { repo:'jellyfin/jellyfin-androidtv', asset:'jellyfin-androidtv-*-release.apk' },
  'ltv-launcher': { repo:'leanbitlab-org/LtvLauncher', asset:'LTvLauncher-universal-release.apk' },
  'aerial-views': { repo:'theothernt/AerialViews', asset:'aerial-views-*.apk' },
  'localsend': { repo:'localsend/localsend', asset:'LocalSend-*-android-arm64v8.apk' },
  'mpv-android': { repo:'mpv-android/mpv-android', asset:'app-default-arm64-v8a-release.apk' },
  'moonlight': { repo:'moonlight-stream/moonlight-android', asset:'app-nonRoot-release.apk' },
  'material-files': { repo:'zhanghai/MaterialFiles', asset:'app-release-universal.apk' },
  'rustdesk': { repo:'rustdesk/rustdesk', asset:'rustdesk-*-aarch64-signed.apk' },
  'obtainium': { repo:'ImranR98/Obtainium', asset:'app-release.apk' },
  'app-manager': { repo:'MuntashirAkon/AppManager', asset:'AppManager_*.apk' },
  'next-player': { repo:'anilbeesetti/nextplayer', asset:'nextplayer-*-universal.apk' },
  'fossify-file-manager': { repo:'FossifyOrg/File-Manager', asset:'file-manager-*-foss-release.apk' },
  'wifi-analyzer': { repo:'VREMSoftwareDevelopment/WiFiAnalyzer', asset:'WiFiAnalyzer-*.apk' },
  'flicky': { repo:'mlm-games/flicky', asset:'flicky-*-universal.apk' },
  'fluffy': { repo:'mlm-games/Fluffy', asset:'fluffy-*-universal.apk' },
  'nebula-screensaver': { repo:'jordanade/Nebula', asset:'Nebula.apk' },
  'matvt': { repo:'virresh/matvt', asset:'matvt-app-release-v*.apk' },
  'apk-updater': { repo:'rumboalla/apkupdater', asset:'com.apkupdater.ci-release.apk' },
  'mrowser': { repo:'m-salehi-v/mrowser', asset:'app-release.apk' },
  'smarttube': { repo:'yuliskov/SmartTube', asset:'SmartTube_stable_*_universal.apk' }
});

const AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;
const HEALTH_REFRESH_MS = 6 * 60 * 60 * 1000;

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
  },
  {
    slug:'flicky', name:'Flicky', category:'store', symbol:'FK',
    iconUrl:'https://raw.githubusercontent.com/mlm-games/flicky/kotlin/fastlane/metadata/android/en-US/images/icon.png',
    description:'متجر F-Droid بواجهة مريحة للشاشات والريموت لتصفح وتثبيت التطبيقات المفتوحة المصدر.',
    devices:'Android TV · Box · Mobile', version:'4.5.2',
    architecture:'Universal', apkSizeBytes:4338885,
    downloadUrl:'https://github.com/mlm-games/flicky/releases/download/4.5.2/flicky-4.5.2-universal.apk',
    downloadMode:'direct', sortOrder:200, enabled:true, featured:true
  },
  {
    slug:'fluffy', name:'Fluffy', category:'files', symbol:'FL',
    iconUrl:'https://raw.githubusercontent.com/mlm-games/Fluffy/main/app/src/main/ic_launcher-playstore.png',
    description:'مدير ملفات سريع بواجهة حديثة ودعم جيد للريموت والأرشيفات على Android TV.',
    devices:'Android TV · Box · Mobile', version:'4.4.7',
    architecture:'Universal', apkSizeBytes:6558122,
    downloadUrl:'https://github.com/mlm-games/Fluffy/releases/download/4.4.7/fluffy-4.4.7-universal.apk',
    downloadMode:'direct', sortOrder:210, enabled:true, featured:false
  },
  {
    slug:'nebula-screensaver', name:'Nebula', category:'screensaver', symbol:'NB',
    iconUrl:'https://raw.githubusercontent.com/jordanade/Nebula/main/fastlane/metadata/android/en-US/images/icon.png',
    description:'شاشة توقف خفيفة بتأثيرات فضائية مصممة خصيصًا لأجهزة Android TV.',
    devices:'Android TV · Google TV · Box', version:'4.12.0',
    architecture:'Universal', apkSizeBytes:209920,
    downloadUrl:'https://github.com/jordanade/Nebula/releases/download/v4.12.0/Nebula.apk',
    downloadMode:'direct', sortOrder:220, enabled:true, featured:false
  },
  {
    slug:'matvt', name:'MATVT', category:'tools', symbol:'MV',
    iconUrl:'https://raw.githubusercontent.com/virresh/matvt/master/app/src/main/ic_launcher-playstore.png',
    description:'ماوس افتراضي مخصص لـ Android TV يمكن التحكم به من نفس الريموت عند الحاجة للمؤشر.',
    devices:'Android TV · Google TV · Box', version:'1.0.6',
    architecture:'Universal', apkSizeBytes:2175957,
    downloadUrl:'https://github.com/virresh/matvt/releases/download/v1.0.6/matvt-app-release-v1.0.6.apk',
    downloadMode:'direct', sortOrder:230, enabled:true, featured:true
  },
  {
    slug:'apk-updater', name:'APKUpdater', category:'tools', symbol:'AU',
    iconUrl:'https://raw.githubusercontent.com/rumboalla/apkupdater/3.x/fastlane/metadata/android/en-US/images/icon.png',
    description:'يفحص تحديثات التطبيقات المثبتة من عدة مصادر ويساعدك في تنزيل أحدث APK.',
    devices:'Android · TV/Box compatible', version:'0.0.604',
    architecture:'Universal', apkSizeBytes:4130561,
    downloadUrl:'https://github.com/rumboalla/apkupdater/releases/download/0.0.604-ci/com.apkupdater.ci-release.apk',
    downloadMode:'direct', sortOrder:240, enabled:true, featured:false
  },
  {
    slug:'mrowser', name:'Mrowser', category:'downloads', symbol:'MR',
    iconUrl:'https://raw.githubusercontent.com/m-salehi-v/mrowser/main/fastlane/metadata/android/en-US/images/icon.png',
    description:'متصفح خفيف مفتوح المصدر مصمم خصيصًا لـ Android TV والتحكم الكامل بالريموت.',
    devices:'Android TV · Google TV · Box', version:'1.3.0',
    architecture:'Universal', apkSizeBytes:4852471,
    downloadUrl:'https://github.com/m-salehi-v/mrowser/releases/download/v1.3.0/app-release.apk',
    downloadMode:'direct', sortOrder:250, enabled:true, featured:true
  },
  {
    slug:'smarttube', name:'SmartTube', category:'media', symbol:'ST',
    iconUrl:'https://raw.githubusercontent.com/yuliskov/SmartTube/master/smarttubetv/src/ststable/res/mipmap-nodpi/app_icon.png',
    description:'مشغل YouTube متقدم ومصمم للشاشات وAndroid TV بواجهة مناسبة للريموت.',
    devices:'Android TV · Google TV · Fire TV · Box', version:'32.47',
    architecture:'Universal', apkSizeBytes:34917013,
    downloadUrl:'https://github.com/yuliskov/SmartTube/releases/download/32.47s/SmartTube_stable_32.47_universal.apk',
    downloadMode:'direct', sortOrder:260, enabled:true, featured:true
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

async function requestWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, {
      ...options,
      redirect: 'manual',
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

async function fetchPublic(url, options = {}) {
  let currentUrl = httpsUrl(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHttpsTarget(currentUrl);
    const response = await requestWithTimeout(currentUrl, options);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect_without_location');
      currentUrl = httpsUrl(new URL(location, currentUrl).toString());
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error('too_many_redirects');
}

export async function inspectRemoteApk(value) {
  const requestedUrl = httpsUrl(value);
  if (!/\.apk$/i.test(new URL(requestedUrl).pathname)) throw new Error('direct_download_must_be_apk');

  let result;
  try {
    result = await fetchPublic(requestedUrl, { method: 'HEAD' });
    if (result.response.status === 405 || result.response.status === 501) {
      result = await fetchPublic(requestedUrl, {
        method: 'GET',
        headers: { range: 'bytes=0-0' }
      });
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('apk_check_timeout');
    if (String(error?.message || '').startsWith('apk_')) throw error;
    throw new Error('apk_check_failed');
  }

  const response = result.response;
  const finalUrl = result.finalUrl;
  if (!response.ok && response.status !== 206) throw new Error(`apk_http_${response.status}`);

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const disposition = String(response.headers.get('content-disposition') || '').toLowerCase();
  const finalLooksLikeApk = /\.apk$/i.test(new URL(finalUrl).pathname) || disposition.includes('.apk');
  const allowedBinary = contentType.includes('android.package-archive')
    || contentType.includes('application/octet-stream')
    || contentType.includes('binary/octet-stream');
  if (!finalLooksLikeApk && !allowedBinary) throw new Error('apk_redirect_not_apk');
  if (contentType && !allowedBinary) throw new Error('apk_unexpected_content_type');

  const rawLength = Number(response.headers.get('content-length') || 0);
  const contentRange = String(response.headers.get('content-range') || '');
  const rangeMatch = contentRange.match(/\/(\d+)$/);
  const sizeBytes = rangeMatch ? Number(rangeMatch[1]) : (Number.isFinite(rawLength) ? rawLength : 0);

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
    featured: flag(raw.featured),
    autoUpdate: Boolean(GITHUB_UPDATE_RULES[slug]) && (raw.autoUpdate === undefined ? true : flag(raw.autoUpdate))
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
  autoUpdate: row.auto_update === true,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
  versionUpdatedAt: row.version_updated_at ? new Date(row.version_updated_at).getTime() : 0,
  previousVersion: row.previous_version || '',
  previousDownloadUrl: row.previous_download_url || '',
  previousApkSizeBytes: Number(row.previous_apk_size_bytes || 0),
  previousSavedAt: row.previous_saved_at ? new Date(row.previous_saved_at).getTime() : 0,
  updatedAt: new Date(row.updated_at).getTime()
});

async function insertSeed(client, item) {
  await client.query(
    `insert into blofy_app_catalog
     (slug,name,category,symbol,icon_url,description,devices,version,architecture,apk_size_bytes,download_url,download_mode,sort_order,enabled,featured,auto_update,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
     on conflict(slug) do nothing`,
    [item.slug,item.name,item.category,item.symbol,item.iconUrl,item.description,item.devices,item.version,item.architecture,item.apkSizeBytes,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured,item.autoUpdate]
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
        auto_update boolean not null default false,
        created_at timestamptz,
        version_updated_at timestamptz,
        previous_version text,
        previous_download_url text,
        previous_apk_size_bytes bigint,
        previous_saved_at timestamptz,
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("alter table blofy_app_catalog add column if not exists icon_url text not null default ''");
    await client.query("alter table blofy_app_catalog add column if not exists architecture text not null default ''");
    await client.query("alter table blofy_app_catalog add column if not exists apk_size_bytes bigint not null default 0");
    await client.query("alter table blofy_app_catalog add column if not exists auto_update boolean not null default false");
    await client.query("alter table blofy_app_catalog add column if not exists created_at timestamptz");
    await client.query("alter table blofy_app_catalog add column if not exists version_updated_at timestamptz");
    await client.query("alter table blofy_app_catalog add column if not exists previous_version text");
    await client.query("alter table blofy_app_catalog add column if not exists previous_download_url text");
    await client.query("alter table blofy_app_catalog add column if not exists previous_apk_size_bytes bigint");
    await client.query("alter table blofy_app_catalog add column if not exists previous_saved_at timestamptz");
    await client.query(`
      create table if not exists blofy_app_catalog_meta (
        id smallint primary key check(id=1),
        seed_version integer not null default 0,
        last_refresh_at timestamptz,
        last_refresh_summary text not null default '',
        last_health_at timestamptz,
        last_health_summary text not null default ''
      )
    `);
    await client.query("alter table blofy_app_catalog_meta add column if not exists last_refresh_at timestamptz");
    await client.query("alter table blofy_app_catalog_meta add column if not exists last_refresh_summary text not null default ''");
    await client.query("alter table blofy_app_catalog_meta add column if not exists last_health_at timestamptz");
    await client.query("alter table blofy_app_catalog_meta add column if not exists last_health_summary text not null default ''");
    await client.query(`
      create table if not exists blofy_download_stats (
        key text primary key,
        download_count bigint not null default 0,
        last_download_at timestamptz
      )
    `);
    await client.query(`
      create table if not exists blofy_app_health (
        slug text primary key references blofy_app_catalog(slug) on delete cascade,
        ok boolean,
        status_code integer,
        size_bytes bigint not null default 0,
        checked_at timestamptz,
        error text not null default '',
        consecutive_failures integer not null default 0
      )
    `);
    await client.query("alter table blofy_app_health add column if not exists consecutive_failures integer not null default 0");
    await client.query(`
      create table if not exists blofy_app_audit (
        id bigserial primary key,
        slug text,
        actor text not null,
        action text not null,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      update blofy_app_catalog
      set created_at=now()
      where created_at is null and slug in ('matvt','apk-updater','mrowser','smarttube')
    `);
    await client.query('insert into blofy_app_catalog_meta(id,seed_version) values(1,0) on conflict(id) do nothing');
    const version = Number((await client.query('select seed_version from blofy_app_catalog_meta where id=1 for update')).rows[0]?.seed_version || 0);

    if (version < SEED_VERSION) {
      for (const seed of DEFAULT_APPS) {
        const item = cleanApp(seed);
        await insertSeed(client, item);
        await client.query(
          'update blofy_app_catalog set architecture=$2, apk_size_bytes=$3, auto_update=$4 where slug=$1',
          [item.slug, item.architecture, item.apkSizeBytes, item.autoUpdate]
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
  const result = includeDisabled
    ? await pool.query(
        `select c.* from blofy_app_catalog c
         order by c.featured desc, c.sort_order asc, c.name asc
         limit 200`
      )
    : await pool.query(
        `select c.* from blofy_app_catalog c
         left join blofy_app_health h on h.slug=c.slug
         where c.enabled=true and coalesce(h.consecutive_failures,0) < 2
         order by c.featured desc, c.sort_order asc, c.name asc
         limit 200`
      );
  return result.rows.map(mapRow);
}

export async function getApp(slug, includeDisabled = false) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) return null;
  const result = includeDisabled
    ? await pool.query('select c.* from blofy_app_catalog c where c.slug=$1 limit 1', [cleanSlug])
    : await pool.query(
        `select c.* from blofy_app_catalog c
         left join blofy_app_health h on h.slug=c.slug
         where c.slug=$1 and c.enabled=true and coalesce(h.consecutive_failures,0) < 2
         limit 1`,
        [cleanSlug]
      );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function writeAudit(action, slug, actor = 'system', details = {}) {
  await pool.query(
    'insert into blofy_app_audit(slug,actor,action,details) values($1,$2,$3,$4::jsonb)',
    [slug || null, actor, action, JSON.stringify(details || {})]
  );
}

export async function listAppAudit(limit = 40) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 40)));
  const result = await pool.query(
    'select id,slug,actor,action,details,created_at from blofy_app_audit order by id desc limit $1',
    [safeLimit]
  );
  return result.rows.map(row => ({
    id: Number(row.id),
    slug: row.slug || '',
    actor: row.actor,
    action: row.action,
    details: row.details || {},
    createdAt: new Date(row.created_at).getTime()
  }));
}

export async function upsertApp(raw) {
  const item = cleanApp(raw);
  const count = await pool.query('select count(*)::int as n from blofy_app_catalog');
  const existing = await pool.query('select * from blofy_app_catalog where slug=$1', [item.slug]);
  if (!existing.rowCount && count.rows[0].n >= 200) throw new Error('app_catalog_full');
  const result = await pool.query(
    `insert into blofy_app_catalog
     (slug,name,category,symbol,icon_url,description,devices,version,architecture,apk_size_bytes,download_url,download_mode,sort_order,enabled,featured,auto_update,created_at,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())
     on conflict(slug) do update set
       previous_version=case
         when blofy_app_catalog.version is distinct from excluded.version
           or blofy_app_catalog.download_url is distinct from excluded.download_url
         then blofy_app_catalog.version else blofy_app_catalog.previous_version end,
       previous_download_url=case
         when blofy_app_catalog.version is distinct from excluded.version
           or blofy_app_catalog.download_url is distinct from excluded.download_url
         then blofy_app_catalog.download_url else blofy_app_catalog.previous_download_url end,
       previous_apk_size_bytes=case
         when blofy_app_catalog.version is distinct from excluded.version
           or blofy_app_catalog.download_url is distinct from excluded.download_url
         then blofy_app_catalog.apk_size_bytes else blofy_app_catalog.previous_apk_size_bytes end,
       previous_saved_at=case
         when blofy_app_catalog.version is distinct from excluded.version
           or blofy_app_catalog.download_url is distinct from excluded.download_url
         then now() else blofy_app_catalog.previous_saved_at end,
       version_updated_at=case
         when blofy_app_catalog.version is distinct from excluded.version
           or blofy_app_catalog.download_url is distinct from excluded.download_url
         then now() else blofy_app_catalog.version_updated_at end,
       name=excluded.name, category=excluded.category, symbol=excluded.symbol, icon_url=excluded.icon_url,
       description=excluded.description, devices=excluded.devices, version=excluded.version,
       architecture=excluded.architecture, apk_size_bytes=excluded.apk_size_bytes,
       download_url=excluded.download_url, download_mode=excluded.download_mode,
       sort_order=excluded.sort_order, enabled=excluded.enabled, featured=excluded.featured,
       auto_update=excluded.auto_update, updated_at=now()
     returning *`,
    [item.slug,item.name,item.category,item.symbol,item.iconUrl,item.description,item.devices,item.version,item.architecture,item.apkSizeBytes,item.downloadUrl,item.downloadMode,item.sortOrder,item.enabled,item.featured,item.autoUpdate]
  );
  const before = existing.rows[0] || null;
  const after = result.rows[0];
  await writeAudit(before ? 'app_update' : 'app_create', item.slug, 'admin', {
    fromVersion: before?.version || '',
    toVersion: after.version || '',
    urlChanged: Boolean(before && before.download_url !== after.download_url)
  });
  return mapRow(after);
}

export async function deleteApp(slug) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) throw new Error('invalid_app_slug');
  const existing = await pool.query('select name,version from blofy_app_catalog where slug=$1', [cleanSlug]);
  const result = await pool.query('delete from blofy_app_catalog where slug=$1 returning slug', [cleanSlug]);
  if (!result.rowCount) throw new Error('app_not_found');
  await writeAudit('app_delete', cleanSlug, 'admin', {
    name: existing.rows[0]?.name || '',
    version: existing.rows[0]?.version || ''
  });
}

export async function rollbackApp(slug) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) throw new Error('invalid_app_slug');
  const currentResult = await pool.query('select * from blofy_app_catalog where slug=$1', [cleanSlug]);
  if (!currentResult.rowCount) throw new Error('app_not_found');
  const current = currentResult.rows[0];
  if (!current.previous_download_url) throw new Error('no_previous_app_version');

  const inspection = await inspectRemoteApk(current.previous_download_url);
  const previousSize = inspection.sizeBytes > 0
    ? inspection.sizeBytes
    : Number(current.previous_apk_size_bytes || 0);

  const result = await pool.query(
    `update blofy_app_catalog set
       version=coalesce(previous_version,''),
       download_url=previous_download_url,
       apk_size_bytes=$2,
       previous_version=version,
       previous_download_url=download_url,
       previous_apk_size_bytes=apk_size_bytes,
       previous_saved_at=now(),
       version_updated_at=now(),
       updated_at=now()
     where slug=$1
     returning *`,
    [cleanSlug, previousSize]
  );
  await writeAudit('app_rollback', cleanSlug, 'admin', {
    fromVersion: current.version || '',
    toVersion: result.rows[0].version || ''
  });
  return mapRow(result.rows[0]);
}

function wildcardMatch(value, pattern) {
  const input = String(value || '').toLowerCase();
  const rule = String(pattern || '').toLowerCase();
  const parts = rule.split('*').filter(Boolean);
  if (!rule.startsWith('*') && parts[0] && !input.startsWith(parts[0])) return false;
  if (!rule.endsWith('*') && parts.length && !input.endsWith(parts[parts.length - 1])) return false;
  let position = 0;
  for (const part of parts) {
    const index = input.indexOf(part, position);
    if (index < 0) return false;
    position = index + part.length;
  }
  return true;
}

function releaseVersion(tag) {
  const clean = String(tag || '').trim().replace(/^v/i, '');
  const semver = clean.match(/\d+(?:\.\d+){1,3}/);
  return semver ? semver[0] : clean.slice(0, 40);
}

async function latestGitHubAsset(rule) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(rule.repo)) throw new Error('invalid_update_repo');
  const apiUrl = `https://api.github.com/repos/${rule.repo}/releases/latest`;
  const { response } = await fetchPublic(apiUrl, {
    method: 'GET',
    headers: { accept: 'application/vnd.github+json' }
  });
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  const release = await response.json();
  if (!release || release.draft || release.prerelease) throw new Error('github_release_not_stable');
  const asset = Array.isArray(release.assets)
    ? release.assets.find(item => item && wildcardMatch(item.name, rule.asset) && /\.apk$/i.test(String(item.name || '')))
    : null;
  if (!asset?.browser_download_url) throw new Error('github_apk_asset_not_found');
  const downloadUrl = httpsUrl(asset.browser_download_url);
  if (!/\.apk$/i.test(new URL(downloadUrl).pathname)) throw new Error('github_asset_not_apk');
  return {
    version: releaseVersion(release.tag_name || release.name),
    downloadUrl,
    apkSizeBytes: Math.max(0, Math.floor(Number(asset.size || 0) || 0))
  };
}

export async function getAppUpdateState() {
  const result = await pool.query('select last_refresh_at,last_refresh_summary from blofy_app_catalog_meta where id=1');
  const row = result.rows[0] || {};
  let summary = {};
  try { summary = JSON.parse(row.last_refresh_summary || '{}'); } catch {}
  return {
    lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at).getTime() : 0,
    summary
  };
}

async function refreshOneManagedApp(app, rule) {
  try {
    const latest = await latestGitHubAsset(rule);
    const changed = app.version !== latest.version
      || app.downloadUrl !== latest.downloadUrl
      || (latest.apkSizeBytes > 0 && app.apkSizeBytes !== latest.apkSizeBytes);
    if (!changed) return { slug: app.slug, status: 'unchanged', version: app.version };

    const inspection = await inspectRemoteApk(latest.downloadUrl);
    const verifiedSize = inspection.sizeBytes > 0 ? inspection.sizeBytes : latest.apkSizeBytes;

    await pool.query(
      `update blofy_app_catalog
       set previous_version=version,
           previous_download_url=download_url,
           previous_apk_size_bytes=apk_size_bytes,
           previous_saved_at=now(),
           version=$2,
           download_url=$3,
           apk_size_bytes=case when $4 > 0 then $4 else apk_size_bytes end,
           version_updated_at=now(),
           updated_at=now()
       where slug=$1`,
      [app.slug, latest.version, latest.downloadUrl, verifiedSize]
    );
    await writeAudit('app_auto_update', app.slug, 'system', {
      fromVersion: app.version || '',
      toVersion: latest.version
    });
    return { slug: app.slug, status: 'updated', version: latest.version };
  } catch (error) {
    return { slug: app.slug, status: 'failed', error: String(error?.message || 'update_failed').slice(0, 80) };
  }
}

export async function refreshManagedApps({ force = false } = {}) {
  const state = await getAppUpdateState();
  const now = Date.now();
  if (!force && state.lastRefreshAt && now - state.lastRefreshAt < AUTO_REFRESH_MS) {
    return { skipped: true, ...state.summary, lastRefreshAt: state.lastRefreshAt };
  }

  const apps = (await listApps(true)).filter(app => app.autoUpdate && GITHUB_UPDATE_RULES[app.slug]);
  const results = [];
  const concurrency = 4;
  for (let index = 0; index < apps.length; index += concurrency) {
    const batch = apps.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map(app => refreshOneManagedApp(app, GITHUB_UPDATE_RULES[app.slug])));
    results.push(...batchResults);
  }

  const summary = {
    checked: results.length,
    updated: results.filter(item => item.status === 'updated').length,
    unchanged: results.filter(item => item.status === 'unchanged').length,
    failed: results.filter(item => item.status === 'failed').length
  };
  await pool.query(
    'update blofy_app_catalog_meta set last_refresh_at=now(), last_refresh_summary=$1 where id=1',
    [JSON.stringify(summary)]
  );
  return { skipped: false, ...summary, results, lastRefreshAt: Date.now() };
}


export async function recordDownload(key) {
  const cleanKey = String(key || '').trim().toLowerCase();
  if (!/^(?:blofy|app:[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(cleanKey)) throw new Error('invalid_download_stat_key');
  await pool.query(
    `insert into blofy_download_stats(key,download_count,last_download_at)
     values($1,1,now())
     on conflict(key) do update set
       download_count=blofy_download_stats.download_count+1,
       last_download_at=now()`,
    [cleanKey]
  );
}

export async function getDownloadStats() {
  const result = await pool.query(
    'select key,download_count,last_download_at from blofy_download_stats order by download_count desc,key asc limit 500'
  );
  const byKey = {};
  let total = 0;
  let appDownloads = 0;
  for (const row of result.rows) {
    const downloadCount = Number(row.download_count || 0);
    const item = {
      downloadCount,
      lastDownloadAt: row.last_download_at ? new Date(row.last_download_at).getTime() : 0
    };
    byKey[row.key] = item;
    total += downloadCount;
    if (String(row.key).startsWith('app:')) appDownloads += downloadCount;
  }
  return {
    total,
    blofyDownloads: Number(byKey.blofy?.downloadCount || 0),
    appDownloads,
    byKey
  };
}

export async function getAppHealthState() {
  const [metaResult, healthResult] = await Promise.all([
    pool.query('select last_health_at,last_health_summary from blofy_app_catalog_meta where id=1'),
    pool.query('select slug,ok,status_code,size_bytes,checked_at,error,consecutive_failures from blofy_app_health')
  ]);
  const meta = metaResult.rows[0] || {};
  let summary = {};
  try { summary = JSON.parse(meta.last_health_summary || '{}'); } catch {}
  const bySlug = {};
  for (const row of healthResult.rows) {
    bySlug[row.slug] = {
      ok: row.ok === true,
      statusCode: row.status_code == null ? 0 : Number(row.status_code),
      sizeBytes: Number(row.size_bytes || 0),
      checkedAt: row.checked_at ? new Date(row.checked_at).getTime() : 0,
      error: String(row.error || ''),
      consecutiveFailures: Number(row.consecutive_failures || 0)
    };
  }
  return {
    lastHealthAt: meta.last_health_at ? new Date(meta.last_health_at).getTime() : 0,
    summary,
    bySlug
  };
}

async function checkOneAppHealth(app) {
  try {
    const info = await inspectRemoteApk(app.downloadUrl);
    await pool.query(
      `insert into blofy_app_health(slug,ok,status_code,size_bytes,checked_at,error,consecutive_failures)
       values($1,true,$2,$3,now(),'',0)
       on conflict(slug) do update set
         ok=true,status_code=excluded.status_code,size_bytes=excluded.size_bytes,
         checked_at=now(),error='',consecutive_failures=0`,
      [app.slug, info.status, info.sizeBytes]
    );
    if (info.sizeBytes > 0 && Number(app.apkSizeBytes || 0) !== info.sizeBytes) {
      await pool.query('update blofy_app_catalog set apk_size_bytes=$2 where slug=$1', [app.slug, info.sizeBytes]);
    }
    return { slug: app.slug, status: 'ok', statusCode: info.status };
  } catch (error) {
    const message = String(error?.message || 'health_check_failed').slice(0, 120);
    const match = message.match(/(?:apk_http_|github_http_)(\d{3})/);
    const statusCode = match ? Number(match[1]) : 0;
    await pool.query(
      `insert into blofy_app_health(slug,ok,status_code,size_bytes,checked_at,error,consecutive_failures)
       values($1,false,$2,0,now(),$3,1)
       on conflict(slug) do update set
         ok=false,status_code=excluded.status_code,checked_at=now(),error=excluded.error,
         consecutive_failures=blofy_app_health.consecutive_failures+1`,
      [app.slug, statusCode || null, message]
    );
    return { slug: app.slug, status: 'failed', error: message };
  }
}

export async function refreshAppHealth({ force = false } = {}) {
  const state = await getAppHealthState();
  const now = Date.now();
  if (!force && state.lastHealthAt && now - state.lastHealthAt < HEALTH_REFRESH_MS) {
    return { skipped: true, ...state.summary, lastHealthAt: state.lastHealthAt };
  }

  const apps = (await listApps(false)).filter(app => app.downloadMode === 'direct');
  const results = [];
  const concurrency = 4;
  for (let index = 0; index < apps.length; index += concurrency) {
    const batch = apps.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(checkOneAppHealth)));
  }

  const summary = {
    checked: results.length,
    healthy: results.filter(item => item.status === 'ok').length,
    failed: results.filter(item => item.status === 'failed').length
  };
  await pool.query(
    'update blofy_app_catalog_meta set last_health_at=now(), last_health_summary=$1 where id=1',
    [JSON.stringify(summary)]
  );
  return { skipped: false, ...summary, results, lastHealthAt: Date.now() };
}

export async function closeAppLibrary() {
  await pool.end();
}
