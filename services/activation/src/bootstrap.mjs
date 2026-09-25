// Install the persisted production data key before any crypto-aware handler is imported.
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
await import('./sources-admin-hook.mjs');
await import('./xtream-admin-hook.mjs');
await import('./xtream-gateway-hook.mjs');
await import('./sources-curated-catalog.mjs');
await import('./subscriber-resolve-hook.mjs');
await import('./server.mjs');
await import('./migration-pull-once.mjs');
