# BLOFY PLAYER 2.0 — Production deployment runbook

This runbook covers the remaining external deployment work after the Android/activation/FFmpeg CI gates are green.

## 1. Deploy activation service on Railway

Use `services/activation` as the Railway service root. The repository already includes `services/activation/railway.toml` and a Dockerfile.

Create a PostgreSQL service and expose its connection string to the activation service as `DATABASE_URL`.

Required environment variables:

- `DATABASE_URL`: Railway PostgreSQL connection string.
- `BLOFY_ADMIN_TOKEN`: at least 24 random characters. Use a generated production secret; never commit it.
- `BLOFY_TRIAL_DAYS=7` unless product policy changes.
- `PORT`: Railway normally injects this automatically.
- `PGSSLMODE`: leave unset in production unless the managed database requires another mode.

The service refuses to start if `DATABASE_URL` is missing or if `BLOFY_ADMIN_TOKEN` is too short.

## 2. Production health gate

After Railway reports the deployment healthy, verify:

- `GET /health` returns HTTP 200.
- Database initialization completed without errors.
- The public endpoint is HTTPS.
- No admin token or database credential appears in public logs or responses.

## 3. Activation smoke test

Run the service smoke test against the production URL or reproduce the same sequence manually:

1. New device + matching six-digit code returns `trial`.
2. Repeating the same device/code keeps the same entitlement rather than creating a new trial.
3. Wrong code for an existing device is rejected.
4. Admin activation changes the device to `active` with the requested expiry.
5. Admin block changes the device to `blocked` and Connect is denied.
6. Expired trial/activation returns `expired`.

## 4. Build Android against production activation

Set the Gradle property when building the release candidate:

`BLOFY_ACTIVATION_BASE_URL=https://<production-host>/`

Do not hardcode a temporary Railway preview URL in source code. The Android client expects `POST /api/v1/activation/check` under this base URL.

## 5. FFmpeg release candidate

Use the CI-produced Media3 1.6.1-compatible FFmpeg AAR. Build BLOFY with the FFmpeg input property configured so `BuildConfig.FFMPEG_EXTENSION_BUNDLED` is true.

Verify in BLOFY Settings that the build reports FFmpeg as bundled before codec QA.

## 6. Physical-device QA gate

Test at least one Android TV/box and one Android phone/tablet build. For each provider profile test:

- Xtream Live TS and HLS.
- M3U/M3U8 direct streams.
- SD/HD/4K/HEVC where the device supports them.
- AC3/EAC3 and any available DTS-class sample using the FFmpeg build.
- Mini preview -> fullscreen transition.
- CH+/CH-, numeric channel entry, EPG and Catch-up.
- Movie resume/start-over.
- Series next/previous and auto-next.
- Audio/subtitle/quality menus.
- Server switch without losing favorites/locks/watch state.
- Cold app start using local Room data without forced sync.
- Manual refresh and failure recovery.
- Media3 terminal error -> configured external-player fallback.

Record TTFF, buffering count and terminal errors from BLOFY diagnostics for every failed case.

## 7. Alpha release gate

Do not call the Alpha production-ready until all three are true:

1. Android CI, Activation CI and FFmpeg Native CI are green on the same head commit.
2. Production activation endpoint passes the smoke test.
3. Real-device codec/server QA is documented with no release-blocking failures.
