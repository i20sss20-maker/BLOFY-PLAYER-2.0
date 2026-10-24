/** Optional signed QA upgrade for owners already using Android TV v74. */
export const CINEMATIC_V74_PATCH = Object.freeze({
  tag: 'v74-cinema-refresh-qa-20261024',
  fileName: 'BLOFY-PLAYER-Android-TV-v74-CINEMA-FIX-SIGNED.apk',
  versionName: '2.0.0-rc07.55.6',
  versionCode: 2000075,
  downloadPath: '/download/v74-cinema-fix.apk'
});
export const CINEMATIC_V74_PATCH_APK_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  CINEMATIC_V74_PATCH.tag + '/' + CINEMATIC_V74_PATCH.fileName;
export const CINEMATIC_V74_PATCH_CHECKSUM_URL = CINEMATIC_V74_PATCH_APK_URL + '.sha256';

/** Separate QA link: never alter /d/blofy, stable app version, or historical downloads. */
export function renderCinematicV74PatchCard() {
  return '<section class="official-card" data-cinematic-v74-patch="true" style="margin-top:12px" aria-label="نسخة بلوفي بلاير 74 لتجربة التصحيح">' +
    '<div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY"></div>' +
    '<div class="official-copy">' +
    '<div class="official-title"><h2 style="margin:0;font-size:20px">BLOFY PLAYER 74 — تجربة إصلاح الثيم والتحديث</h2><span class="badge">نسخة تجربة 74 محسّنة موقّعة</span></div>' +
    '<div class="official-desc">بنفسجي سينمائي أوضح في الخلفية والبانر والبوسترات. زر تحديث المحتوى لا يدور أثناء الانتظار، ويعرض العمل بالخلفية ويوفر الإلغاء إذا تعلّق.</div>' +
    '<div class="official-meta">' + CINEMATIC_V74_PATCH.versionName + ' · Build داخلي ' + CINEMATIC_V74_PATCH.versionCode + ' · Signed QA APK</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start">تثبّت فوق النسخة 74 المتوافقة دون حذف بياناتك. ما زالت بحاجة لتجربة البث والمكتبة على Android TV فعليًا؛ التحديث التلقائي الرسمي لم يتغيّر.</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start"><a rel="noopener noreferrer" href="' + CINEMATIC_V74_PATCH_CHECKSUM_URL + '">التحقق من بصمة SHA-256</a></div>' +
    '</div><a class="official-download" href="' + CINEMATIC_V74_PATCH.downloadPath + '">تجربة إصلاح بلوفي 74 ↓</a></section>';
}
