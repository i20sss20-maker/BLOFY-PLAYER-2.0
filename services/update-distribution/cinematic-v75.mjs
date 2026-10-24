/** Optional signed QA upgrade for owners already using Android TV v74. */
export const CINEMATIC_V75 = Object.freeze({
  tag: 'v75-cinema-refresh-qa-20261024',
  fileName: 'BLOFY-PLAYER-Android-TV-v75-CINEMA-FIX-SIGNED.apk',
  versionName: '2.0.0-rc07.55.7',
  versionCode: 2000075,
  downloadPath: '/download/v75-cinema-fix.apk'
});
export const CINEMATIC_V75_APK_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  CINEMATIC_V75.tag + '/' + CINEMATIC_V75.fileName;
export const CINEMATIC_V75_CHECKSUM_URL = CINEMATIC_V75_APK_URL + '.sha256';

/** Separate QA link: never alter /d/blofy, stable app version, or historical downloads. */
export function renderCinematicV75Card() {
  return '<section class="official-card" data-cinematic-v75="true" style="margin-top:12px" aria-label="نسخة بلوفي بلاير 75 لتجربة التصحيح">' +
    '<div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY"></div>' +
    '<div class="official-copy">' +
    '<div class="official-title"><h2 style="margin:0;font-size:20px">BLOFY PLAYER 75 — تجربة إصلاح الثيم والتحديث</h2><span class="badge">نسخة تجربة موقّعة</span></div>' +
    '<div class="official-desc">بنفسجي سينمائي أوضح في الخلفية والبانر والبوسترات. زر تحديث المحتوى لا يدور أثناء الانتظار، ويعرض العمل بالخلفية ويوفر الإلغاء إذا تعلّق.</div>' +
    '<div class="official-meta">' + CINEMATIC_V75.versionName + ' · Version Code ' + CINEMATIC_V75.versionCode + ' · Signed QA APK</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start">تثبّت فوق النسخة 74 المتوافقة دون حذف بياناتك. ما زالت بحاجة لتجربة البث والمكتبة على Android TV فعليًا؛ التحديث التلقائي الرسمي لم يتغيّر.</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start"><a rel="noopener noreferrer" href="' + CINEMATIC_V75_CHECKSUM_URL + '">التحقق من بصمة SHA-256</a></div>' +
    '</div><a class="official-download" href="' + CINEMATIC_V75.downloadPath + '">تجربة إصلاح بلوفي 75 ↓</a></section>';
}
