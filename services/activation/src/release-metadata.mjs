export const ACTIVATION_SERVICE_VERSION = '1.1.0';

const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const VERSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

const DEFAULT_APP_RELEASE = Object.freeze({
  versionCode: 2000073,
  versionName: '2.0.0-rc07.55.5',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://updates.blofyplayer.com/files/releases/BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk',
  releaseNotes: 'BLOFY PLAYER 55.5 — تحسين توافق أفلام 4K/HEVC، مع Media3 كمحرك أساسي والانتقال إلى LibVLC الداخلي عند الحاجة. مبني فوق إصلاحات الثيم والأداء ومشتركين BLOFY وDirect Xtream.'
});

export function sanitizeCommitSha(value) {
  const candidate = String(value || '').trim();
  return COMMIT_SHA_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function sanitizeVersionCode(value) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 && candidate <= MAX_ANDROID_VERSION_CODE
    ? candidate
    : null;
}

export function sanitizeVersionName(value) {
  const candidate = String(value || '').trim();
  return VERSION_NAME_PATTERN.test(candidate) ? candidate : null;
}

export function sanitizeHttpsUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizeReleaseNotes(value) {
  const candidate = String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (!candidate) return null;
  return candidate.slice(0, 600);
}

// Keep the public website, activation health and external in-app updater on one approved build.
// This explicit production switch takes precedence over stale legacy BLOFY_APP_* variables.
const APPROVED_PUBLIC_2000082 = Object.freeze({
  versionCode: 2000082,
  versionName: '2.0.0-rc07.55.8.5',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://updates.blofyplayer.com/download/latest.apk',
  releaseNotes: 'BLOFY PLAYER 55.8.5 — تحديث المحتوى يعرض نسبة تقدم حقيقية مستمرة بعد إعادة الاتصال، والفئات حسب ترتيب السيرفر دون فرز محلي. تحديث رسمي موقّع.'
});
const APPROVED_PUBLIC_2000081 = Object.freeze({
  versionCode: 2000081,
  versionName: '2.0.0-rc07.55.8.4',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://updates.blofyplayer.com/download/latest.apk',
  releaseNotes: 'BLOFY PLAYER 55.8.4 — إصلاح انقطاع مصدر القوائم عند تجهيز المكتبة عبر استعادة أقسام القنوات والأفلام والمسلسلات على دفعات آمنة. لا يحذف التفعيل أو القوائم.'
});
const APPROVED_PUBLIC_2000080 = Object.freeze({
  versionCode: 2000080,
  versionName: '2.0.0-rc07.55.8.3',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://updates.blofyplayer.com/download/latest.apk',
  releaseNotes: 'BLOFY PLAYER 55.8.3 — إصلاح ظهور رمز الربط ذي الستة أرقام عند بطء قراءة القوائم، دون تغيير رقم الجهاز أو حذف البيانات. تحديث رسمي موقّع.'
});
const APPROVED_PUBLIC_2000079 = Object.freeze({
  versionCode: 2000079,
  versionName: '2.0.0-rc07.55.8.2',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://updates.blofyplayer.com/download/latest.apk',
  releaseNotes: 'BLOFY PLAYER 55.8.2 — تحسينات القوائم والبطاقات وصفحة الباركود وAndroid TV. تحديث موقّع برقم بناء جديد 2000079.'
});
const APPROVED_PUBLIC_2000078 = Object.freeze({
  versionCode: 2000078,
  versionName: '2.0.0-rc07.55.8.1',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://updates.blofyplayer.com/download/latest.apk',
  releaseNotes: 'BLOFY PLAYER 55.8.1 — تحسين القوائم والبطاقات وصفحة QR والتفعيل وتناسق المربعات، مع إبقاء أعداد المحتوى داخل أقسام المكتبة. تحديث رسمي موقّع بالشهادة الأصلية.'
});

export function appReleaseMetadata(env = process.env) {
  if (String(env.BLOFY_PUBLIC_RELEASE_2000082 || '').toLowerCase() === 'true') {
    return { ...APPROVED_PUBLIC_2000082 };
  }
  if (String(env.BLOFY_PUBLIC_RELEASE_2000081 || '').toLowerCase() === 'true') {
    return { ...APPROVED_PUBLIC_2000081 };
  }
  if (String(env.BLOFY_PUBLIC_RELEASE_2000080 || '').toLowerCase() === 'true') {
    return { ...APPROVED_PUBLIC_2000080 };
  }
  if (String(env.BLOFY_PUBLIC_RELEASE_2000079 || '').toLowerCase() === 'true') {
    return { ...APPROVED_PUBLIC_2000079 };
  }
  if (String(env.BLOFY_PUBLIC_RELEASE_2000078 || '').toLowerCase() === 'true') {
    return { ...APPROVED_PUBLIC_2000078 };
  }
  const configuredVersionCode = sanitizeVersionCode(env.BLOFY_APP_VERSION_CODE);
  const useConfiguredRelease = configuredVersionCode != null && configuredVersionCode >= DEFAULT_APP_RELEASE.versionCode;

  if (!useConfiguredRelease) return { ...DEFAULT_APP_RELEASE };

  const versionName = sanitizeVersionName(env.BLOFY_APP_VERSION_NAME) || DEFAULT_APP_RELEASE.versionName;
  const configuredMinimum = sanitizeVersionCode(env.BLOFY_APP_MIN_SUPPORTED_VERSION_CODE)
    || DEFAULT_APP_RELEASE.minSupportedVersionCode;
  const downloadUrl = sanitizeHttpsUrl(env.BLOFY_APP_DOWNLOAD_URL)
    || DEFAULT_APP_RELEASE.downloadUrl;
  const releaseNotes = sanitizeReleaseNotes(env.BLOFY_APP_RELEASE_NOTES)
    || DEFAULT_APP_RELEASE.releaseNotes;

  return {
    versionCode: configuredVersionCode,
    versionName,
    minSupportedVersionCode: Math.min(configuredMinimum, configuredVersionCode),
    downloadUrl,
    releaseNotes
  };
}

export function activationReleaseMetadata(env = process.env) {
  const vercelCommitSha = sanitizeCommitSha(env.VERCEL_GIT_COMMIT_SHA);
  const railwayCommitSha = sanitizeCommitSha(env.RAILWAY_GIT_COMMIT_SHA);
  const fallbackCommitSha = sanitizeCommitSha(env.BLOFY_RELEASE_COMMIT_SHA);
  const platform = env.VERCEL === '1' || vercelCommitSha
    ? 'vercel'
    : railwayCommitSha
      ? 'railway'
      : 'self-hosted';
  return {
    service: 'blofy-activation',
    version: ACTIVATION_SERVICE_VERSION,
    platform,
    commitSha: vercelCommitSha || railwayCommitSha || fallbackCommitSha,
    app: appReleaseMetadata(env)
  };
}
