# 2026-11-24 — Isolated STREAM Web preview: manual profile backup and merge

Scope: **only** Railway BLOFY-VIDAA-PREVIEW / blofy-stream-native-web-parity. The Android customer releases, activation portal, PostgreSQL and media-worker source/feature flags are unchanged by this marker.

## Operator-selected preview publication
Publish the new browser UI-only **local** account favorites and watched-position backup/import into the isolated BLOFY STREAM Web preview. Never call it cloud sync. A user must already have an active code-only STREAM Web session before seeing the settings control. Download is an explicit local JSON file; file import requires an explicit review and second confirmation. The data may be moved only to another device accessing the same origin/content catalog; catalog IDs are source-specific.

- Export includes only numeric gateway IDs, scrubbed titles, file-format hints, and movie/episode checkpoints. Never export cookies, access token, activation code, device ID, source URLs, M3U/Xtream credentials, poster URLs, user search history or video bytes.
- Import rejects invalid and duplicate IDs, unsupported versions, unexpected schema/secret fields, oversized payloads, and profile changes between read and confirm.
- Non-destructive merge preserves newest existing positions, existing favorites and rich metadata. Quota failures are reported with best-effort local rollback. No customer server endpoint or database is added.
- UI is ES5-compatible for older Toshiba/VIDAA browsers, but **actual physical VIDAA file picker/download behavior remains unverified**. On TVs without file downloads the interface reports the limitation rather than claiming transfer succeeded.

## Verification and controlled risk
- Exact code merged from PR #838, commit `f2de6e79f8d8d074d9b8b7eb9f689723caf1a61f`.
- Offline targeted GitHub Actions for private schema, credential exclusion, prototype safety, merge/account-epoch guard and denial cases completed SUCCESS at pull request head `ac3af13fd73c565470763633cc75c899e1e6f6e5`.
- Full web UI/brower acceptance was launched for merge SHA but browser-install/FFmpeg runner preparation was still in progress at approval time. **Do not claim full Playwright passed**, and do not roll out as a general production web product. Only this isolated preview may serve the UI-only feature.
- Previous fully green web browser suite: `88de2bd7d50d6d8113ca3ecdb88a020ce5d85125`. The new changes do not alter media processing, customer activation or playback reconnection. The last known-good preview deployment may be rolled back if the new UI fails.
- Review real browser and Toshiba file export/import, then verify both upgraded favorites and continue watching on the second device. Cloud sync with Android remains an independent future feature.
