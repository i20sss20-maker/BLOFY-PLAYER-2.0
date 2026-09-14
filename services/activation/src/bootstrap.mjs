// Force Vercel function rebundle for BLOFY PLAYER rc07.49 release metadata.
import './subscriber-proxy-hook.mjs';
import './subscriber-portal-ui-hook.mjs';
import './admin-session-hook.mjs';
import './admin-device-insights-hook.mjs';
import './admin-console-hook.mjs';
import './subscriber-resolve-hook.mjs';
await import('./server.mjs');
