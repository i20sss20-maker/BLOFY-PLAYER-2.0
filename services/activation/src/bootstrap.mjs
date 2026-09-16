// Force Vercel production rebundle for BLOFY PLAYER portal contact release.
import './migration-export-hook.mjs';
import './migration-import-hook.mjs';
import './subscriber-proxy-hook.mjs';
import './portal-existing-device-login.mjs';
import './subscriber-portal-ui-hook.mjs';
import './portal-contact-hook.mjs';
import './admin-session-hook.mjs';
import './admin-device-insights-hook.mjs';
import './admin-console-hook.mjs';
import './subscriber-resolve-hook.mjs';
await import('./server.mjs');
