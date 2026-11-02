// Explicit one-file archive exception: keep current v75 as the public default,
// and make the preserved 2000073 APK accessible without exposing other retired builds.
export const PLAY73_ARCHIVE_FILE = 'BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk';
export const PLAY73_ARCHIVE_ROUTE = '/files/releases/BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk';
export const PLAY73_ARCHIVE_VERSION_NAME = '2.0.0-rc07.55.5';
export const PLAY73_ARCHIVE_VERSION_CODE = 2000073;

export function shouldRedirectLegacyFile(singleRelease75, filename) {
  return Boolean(singleRelease75) && filename !== PLAY73_ARCHIVE_FILE;
}

export function renderPlay73ArchiveCard() {
  return `<section class="official-card" id="blofy-73-archive" aria-label="BLOFY PLAYER 73 archive">
    <div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY PLAYER"></div>
    <div class="official-copy">
      <div class="official-title"><h2>BLOFY PLAYER 73</h2><span class="badge">نسخة مؤرشفة</span></div>
      <div class="official-desc">الإصدار الأصلي المحفوظ في أرشيف موقع BLOFY: 2.0.0-rc07.55.5 (Version Code 2000073). ليس تحديثًا لنسخة 75. إذا كان جهازك عليه 75 أو 76، لن يقبل أندرويد تثبيت 73 فوق الإصدار الأحدث دون إجراءات الرجوع لإصدار أقدم؛ احفظ بياناتك أولًا ولا تحذف التطبيق قبل النسخ الاحتياطي.</div>
      <div class="official-meta">Version Name 2.0.0-rc07.55.5 · Version Code 2000073 · APK مباشر</div>
      <div class="direct-url">updates.blofyplayer.com/files/releases/BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk</div>
    </div>
    <a class="official-download" href="${PLAY73_ARCHIVE_ROUTE}">تحميل نسخة 73 المؤرشفة ↓</a>
  </section>`;
}
