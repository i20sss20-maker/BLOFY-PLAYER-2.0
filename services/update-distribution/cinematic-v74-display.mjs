/** Latest optional owner QA of BLOFY PLAYER 74, signed by the existing release key. */
export const CINEMATIC_V74_DISPLAY = Object.freeze({
  tag: 'v74-display74-remote-qa-20261025',
  fileName: 'BLOFY-PLAYER-Android-TV-v74-DISPLAY74-SIGNED.apk',
  versionName: '74',
  versionCode: 2000077,
  downloadPath: '/download/v74-display74.apk'
});
export const CINEMATIC_V74_DISPLAY_APK_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  CINEMATIC_V74_DISPLAY.tag + '/' + CINEMATIC_V74_DISPLAY.fileName;
export const CINEMATIC_V74_DISPLAY_CHECKSUM_URL = CINEMATIC_V74_DISPLAY_APK_URL + '.sha256';

/**
 * A visible QA card separate from stable /d/blofy and historical v74 links.
 * Older QA routes remain functional but the site promotes only the latest trial.
 */
export function renderCinematicV74DisplayCard() {
  return '<section class="official-card" data-v74-display-qa="true" style="margin-top:12px" aria-label="نسخة 74 المحسّنة للريموت والسرعة">' +
    '<div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY"></div>' +
    '<div class="official-copy">' +
    '<div class="official-title"><h2 style="margin:0;font-size:20px">BLOFY PLAYER 74 — نسخة التجربة بالرقم الصحيح</h2><span class="badge">نسخة 74 موقّعة للتجربة</span></div>' +
    '<div class="official-desc">رقم الإصدار الظاهر داخل التطبيق 74 مباشرة، مع تحسينات استجابة الريموت وسرعة الواجهات وتقليل تحميل صور البوسترات، وإصلاح الثيم والتحديث.</div>' +
    '<div class="official-meta">الإصدار ' + CINEMATIC_V74_DISPLAY.versionName + ' · ملف APK موقّع للتجربة</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start">تثبت فوق الإصدارات الأقدم المتوافقة مع نفس شهادة التوقيع دون حذف بياناتك. لا تزال نسخة تجربة؛ التحديث التلقائي الرسمي لم يتغير.</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start"><a rel="noopener noreferrer" href="' + CINEMATIC_V74_DISPLAY_CHECKSUM_URL + '">التحقق من SHA-256</a></div>' +
    '</div><a class="official-download" href="' + CINEMATIC_V74_DISPLAY.downloadPath + '">تحميل BLOFY PLAYER 74 الجديدة ↓</a></section>';
}
