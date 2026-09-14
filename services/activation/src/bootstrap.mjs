import './subscriber-proxy-hook.mjs';
import './subscriber-portal-ui-hook.mjs';
import './admin-session-hook.mjs';
import './admin-device-insights-hook.mjs';
import './admin-console-hook.mjs';
import './subscriber-resolve-hook.mjs';

// Production update feed. Keep the deployed app release ahead of stale
// dashboard environment values while preserving all other service settings.
process.env.BLOFY_APP_VERSION_CODE = '2000058';
process.env.BLOFY_APP_VERSION_NAME = '2.0.0-rc07.47';
process.env.BLOFY_APP_MIN_SUPPORTED_VERSION_CODE = '1';
process.env.BLOFY_APP_DOWNLOAD_URL = 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.47/BLOFY-PLAYER-2.0-rc07.47-signed.apk';
process.env.BLOFY_APP_RELEASE_NOTES = 'BLOFY PLAYER 47 — تحسين البحث وعرض الأفلام والمسلسلات كبوسترات، تحسين استجابة الريموت وOK، تحسين تحميل بيانات وصور الطاقم عند توفرها من السيرفر، وتقليل الضغط الخلفي على أجهزة Android TV الضعيفة. يتضمن إصلاحات استقرار التحديث والقوائم مع الحفاظ على محركات التشغيل والثيم.';

await import('./server.mjs');
