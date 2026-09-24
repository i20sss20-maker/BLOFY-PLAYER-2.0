# BLOFY PLAYER 2.0 — Production deployment runbook

## 0. Current verified baseline

- Verified release: `2.0.0-rc07.56`
- Version code: `2000068`
- Git tag: `v2.0.0-rc07.56`
- Recovery branch: `baseline/rc0756-railway-cutover`
- Activation/API: `https://api.blofyplayer.com`
- Portal/root: `https://blofyplayer.com`
- Updates: `https://updates.blofyplayer.com`
- Strict TLS and production smoke checks: passing
- Railway activation, update distribution, and Postgres deployments: healthy
- Final website recovery branch: `baseline/websites-production-final-20260925`
- Final update-service recovery branch: `baseline/update-production-final-20260925`
- Final downloads-preview recovery branch: `baseline/downloads-preview-production-final-20260925`
- Public web smoke coverage: root, device portal, downloads, privacy, admin, sources admin, manifest, robots, sitemap, update center, stable APK link

This runbook reflects the current temporary production topology after the Railway cutover.

## 1. Current production topology

- Public activation/API origin: `https://api.blofyplayer.com`
- Public portal/root origin: `https://blofyplayer.com` (DNS + TLS verified)
- Public update origin: `https://updates.blofyplayer.com`
- Railway project: `BLOFY-Update-Distribution`
- Activation service: `blofy-activation-portal`
- Update service: `blofy-update-distribution`
- Database: Railway Postgres in the same production environment
- Git repository: `i20sss20-maker/BLOFY-PLAYER-2.0`
- Activation service root directory: `services/activation`

The Railway + PostgreSQL stack above is the active production source of truth. All legacy production host references have been removed from active application/service code and production workflows. Older hosting stacks are not part of the production path. Legacy Azure workflows are manual-only and cannot deploy automatically from `main`. Signed Android production builds must use the BLOFY custom domains above.

## 2. Activation service requirements

The activation service requires these production variables:

- `DATABASE_URL` — Railway reference to the production Postgres service.
- `BLOFY_ADMIN_TOKEN` — production-only secret, at least 24 characters.
- `BLOFY_PLAYLIST_ENCRYPTION_KEY` — stable 64-character hexadecimal wrapping key.
- `BLOFY_TRIAL_DAYS` — current product trial duration.
- `PORT=3000` when required by Railway runtime configuration.
- `PGSSLMODE=disable` only because the activation service connects to Postgres through Railway's private network.

Migration-only variables must remain disabled/blank after cutover.

## 3. Production health gate

Before publishing Android or changing DNS, verify:

- `GET https://api.blofyplayer.com/health` returns HTTP 200.
- Response contains `ok: true`, `database: "ready"`, and `playlistEncryption: "ready"`.
- Railway deployment for `blofy-activation-portal` is `SUCCESS`.
- Railway Postgres is healthy and has persistent storage.
- `updates.blofyplayer.com` is attached to `blofy-update-distribution`.

Do not change Media3, FFmpeg, player fallback behavior, stream paths, or theme as part of backend deployment work.

## 4. Android production build

Signed production builds must use:

`-PBLOFY_ACTIVATION_BASE_URL=https://api.blofyplayer.com`

`-PBLOFY_UPDATE_BASE_URL=https://updates.blofyplayer.com`

The Android client appends the `/api/v1/...` paths itself. Do not append `/portal`, `/health`, or a specific API route.

Verify before release:

- application ID remains `tv.blofy.player.v2`;
- production signing certificate is unchanged;
- FFmpeg bundle verification passes;
- activation health gate passes;
- the APK embeds `https://api.blofyplayer.com` and `https://updates.blofyplayer.com`.

## 5. Database safety

The Railway production database contains the migrated activation/playlist state. Never recreate or replace it during a normal deploy.

The persisted BLOFY data-key state must remain present so migrated encrypted playlists continue to decrypt correctly.

Before any future VPS/OVH cutover:

1. Take a database backup.
2. Compare source and target table counts.
3. Verify the persisted data-key state.
4. Switch the custom domains only after the new target passes the health gate.
5. Keep the last healthy Railway deployment available for rollback.

## 6. Update distribution

The production update origin is:

`https://updates.blofyplayer.com`

The live update service is `blofy-update-distribution`. The separate `blofy-downloads-preview` service is a healthy non-production preview service and is intentionally not attached to a public domain.

## 7. Rollback

If Railway activation fails:

1. Keep the Postgres volume intact.
2. Roll back to the last healthy `blofy-activation-portal` deployment.
3. Do not modify Android playback engines to compensate for a backend issue.
4. Do not change DNS or switch hosting stacks during an incident unless a tested rollback target has been explicitly prepared.

Product behavior remains governed by `BLOFY_2_FINAL_REFERENCE_AR.md`.


## 8. Public website surfaces

The production web surfaces are:

- `https://blofyplayer.com/` — main BLOFY portal.
- `https://blofyplayer.com/connect` — device pairing and playlist management.
- `https://blofyplayer.com/downloads` — branded public download center.
- `https://blofyplayer.com/privacy` — privacy and deletion requests.
- `https://blofyplayer.com/admin` — protected device/release administration.
- `https://blofyplayer.com/sources-admin` — protected source/Xtream administration.
- `https://updates.blofyplayer.com/` — official release/download center.
- `https://updates.blofyplayer.com/download/latest.apk` — stable Downloader-compatible APK URL.
- Stable APK aliases: `https://updates.blofyplayer.com/latest.apk` and `https://updates.blofyplayer.com/apk`.

Public pages use the BLOFY identity, responsive layouts, canonical metadata, manifest metadata, robots/sitemap support, branded 404 handling, strict TLS, HSTS, frame protection, and restrictive permissions policies.

The permanent GitHub Actions gate `BLOFY Web Surfaces Smoke` verifies the public pages, health endpoints, release consistency, security headers, branded 404 behavior, and stable APK routes.

## 9. Railway service state

The production Railway project should have all four services healthy:

- `blofy-activation-portal` — production activation/API and web portal.
- `blofy-update-distribution` — production release distribution.
- `Postgres` — production database with persistent volume.
- `blofy-downloads-preview` — non-public preview service.

The preview service must stay without a public/custom domain unless it is deliberately promoted.
