/** Latest optional owner QA of BLOFY PLAYER 74, signed by the existing release key. */
export const CINEMATIC_V74_REMOTE = Object.freeze({
  tag: 'v74-remote-performance-qa-20261025',
  fileName: 'BLOFY-PLAYER-Android-TV-v74-REMOTE-QA-SIGNED.apk',
  versionName: '2.0.0-rc07.55.6',
  versionCode: 2000076,
  downloadPath: '/download/v74-remote-qa.apk'
});
export const CINEMATIC_V74_REMOTE_APK_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  CINEMATIC_V74_REMOTE.tag + '/' + CINEMATIC_V74_REMOTE.fileName;
export const CINEMATIC_V74_REMOTE_CHECKSUM_URL = CINEMATIC_V74_REMOTE_APK_URL + '.sha256';

/**
 * A visible QA card separate from stable /d/blofy and historical v74 links.
 * Older QA routes remain functional but the site promotes only the latest trial.
 */
export function renderCinematicV74RemoteCard() {
  return '<section class="official-card" data-v74-remote-qa="true" style="margin-top:12px" aria-label="نسخة 74 المحسّنة للريموت والسرعة">' +
    '<div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY"></div>' +
    '<div class="official-copy">' +
    '<div class="official-title"><h2 style="margin:0;font-size:20px">BLOFY PLAYER 74 — تجربة تحسين السرعة والريموت</h2><span class="badge">نسخة 74 تجريبية موقّعة</span></div>' +
    '<div class="official-desc">استجابة أسرع لأزرار الريموت، تقليل تحميل صور البوسترات خارج الشاشة، وتخفيف الذاكرة والحركة على أجهزة Android TV الضعيفة. يحتوي أيضًا على إصلاحات الثيم البنفسجي وحالات تحديث المحتوى.</div>' +
    '<div class="official-meta">' + CINEMATIC_V74_REMOTE.versionName + ' · Build داخلي ' + CINEMATIC_V74_REMOTE.versionCode + ' · Signed QA APK</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start">تثبت فوق الإصدارات الأقدم المتوافقة مع نفس شهادة التوقيع دون حذف بياناتك. لا تزال نسخة تجربة؛ التحديث التلقائي الرسمي لم يتغير.</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start"><a rel="noopener noreferrer" href="' + CINEMATIC_V74_REMOTE_CHECKSUM_URL + '">التحقق من SHA-256</a></div>' +
    '</div><a class="official-download" href="' + CINEMATIC_V74_REMOTE.downloadPath + '">تحميل 74 التجريبية المحسّنة ↓</a></section>';
}
