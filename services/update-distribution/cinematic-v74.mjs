/**
 * An optional, release-signed Android TV v74 Cinematic build.
 * The Railway URL proxies the immutable binary stored on GitHub.
 * It does not change the active/stable update release or customer migrations.
 */
export const CINEMATIC_V74 = Object.freeze({
  tag: 'v74-cinematic-approved-20261024',
  fileName: 'BLOFY-PLAYER-Android-TV-v74-CINEMATIC-SIGNED.apk',
  versionName: '2.0.0-rc07.55.6',
  versionCode: 2000074,
  downloadPath: '/download/v74-cinematic.apk',
  sha256: 'e5903c2e041fe95d88ce82f8326a5c45447b2addd47424ae9c6dc740fa911c69'
});
export const CINEMATIC_V74_APK_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' + CINEMATIC_V74.tag + '/' + CINEMATIC_V74.fileName;
export const CINEMATIC_V74_CHECKSUM_URL = CINEMATIC_V74_APK_URL + '.sha256';
export const CINEMATIC_V74_DOWNLOAD_PATH = CINEMATIC_V74.downloadPath;

/** HTML is constructed exclusively from trusted immutable constants. */
export function renderCinematicV74Card() {
  return '<section class="official-card" style="margin-top:12px" aria-label="تحميل بلوفي بلاير 74 السينمائي" data-cinematic-v74="true">' +
    '<div class="official-icon"><img src="https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/app/src/main/res/drawable-nodpi/blofy_logo.png" alt="BLOFY"></div>' +
    '<div class="official-copy">' +
    '<div class="official-title"><h2 style="margin:0;font-size:20px">BLOFY PLAYER 74 — النسخة السينمائية</h2><span class="badge">إصدار موقّع</span></div>' +
    '<div class="official-desc">هوية BLOFY البنفسجية الداكنة، أيقونات جانبية جديدة مع أسماء عربية، بانر وبوسترات محسّنة، وخط عربي أنيق. تحديث المحتوى أوضح، ومحركات التشغيل الأصلية محفوظة.</div>' +
    '<div class="official-meta">' + CINEMATIC_V74.versionName + ' · Version Code ' + CINEMATIC_V74.versionCode + ' · Signed APK</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start">نسخة مستقلة عن رابط التحديث التلقائي. لا تحذف التطبيق أو بياناته. إذا كانت نسختك بنفس رقم البناء 2000074 فقد يرفض Android التثبيت فوقها.</div>' +
    '<div class="official-meta" style="direction:rtl;text-align:start"><a href="' + CINEMATIC_V74_CHECKSUM_URL + '" rel="noopener noreferrer">التحقق من SHA-256</a></div>' +
    '</div><a class="official-download" href="' + CINEMATIC_V74_DOWNLOAD_PATH + '">تحميل 74 السينمائية ↓</a></section>';
}
