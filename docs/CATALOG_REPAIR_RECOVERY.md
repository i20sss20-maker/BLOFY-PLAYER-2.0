# Catalog repair recovery — not a release

Base: df51714acf84119c4f15859f06c4eb1fbc652702, rc07-commercial-stability.

This first review commit recovers and tests the pure progress calculation, durable preparation journal, and physical left/right focus policy from the saved WIP. It does NOT yet change the loading activity or the home key dispatcher. No new APK is approved for production and no end-to-end fix is claimed.

New regressions: 8 progress tests, 8 SQLite journal tests (Robolectric), 5 home focus policy tests. CI must compile and execute them; no local Android build is claimed.

Remaining WIP integration: awaited detail/episode/artwork preparation; readiness after local home/search finalization; bounded visible failures and retry; source-change/incomplete-response handling; home row focus wiring; duplicate identity and delete reconciliation (requires matching activation-service review).

Do not merge a partial recovery into production, change player engines/routes, rename existing saved playlists, delete real account data, or issue a signed release before integration checks. Website main updates, including optional playlist names and subscriber fields, must be preserved separately.
