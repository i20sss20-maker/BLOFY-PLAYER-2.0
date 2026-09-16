// Vercel/rollback bootstrap. Load a persisted production data key when present.
import { installPersistedDataKey } from './data-key-state.mjs';
await installPersistedDataKey();

await import('./migration-export-hook.mjs');
await import('./migration-import-hook.mjs');
await import('./subscriber-proxy-hook.mjs');
await import('./portal-existing-device-login.mjs');
await import('./subscriber-portal-ui-hook.mjs');
await import('./portal-contact-hook.mjs');
await import('./admin-session-hook.mjs');
await import('./admin-device-insights-hook.mjs');
await import('./admin-console-hook.mjs');
await import('./subscriber-resolve-hook.mjs');
await import('./server.mjs');
