// Azure managed activation bootstrap. Temporary migration audit is read-only
// and will be removed immediately after the source/target comparison is captured.
await import('./azure-migration-audit-once.mjs');
import './subscriber-proxy-hook.mjs';
import './portal-existing-device-login.mjs';
import './subscriber-portal-ui-hook.mjs';
import './portal-contact-hook.mjs';
import './admin-session-hook.mjs';
import './admin-device-insights-hook.mjs';
import './admin-console-hook.mjs';
import './subscriber-resolve-hook.mjs';
await import('./server.mjs');
