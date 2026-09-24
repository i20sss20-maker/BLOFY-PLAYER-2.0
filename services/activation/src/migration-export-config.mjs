// Temporary migration export gate. The production migration workflow writes an
// ephemeral PUBLIC key here, then restores this file to the disabled state.
// No private key or database credential is ever committed.
export const MIGRATION_EXPORT_PUBLIC_KEY = '';
export const MIGRATION_EXPORT_EXPIRES_AT = 1790279693210;
