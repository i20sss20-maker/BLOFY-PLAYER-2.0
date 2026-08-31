# BLOFY PLAYER 2.0 — Production deployment runbook

This is the current production runbook for the BLOFY activation and playlist portal. The active stack is **Vercel + Neon Postgres**; Railway is not part of the production topology.

The product behavior and regression rules remain defined by [`BLOFY_2_FINAL_REFERENCE_AR.md`](BLOFY_2_FINAL_REFERENCE_AR.md). This runbook only covers deployment and release verification.

## 1. Current production topology

- Public origin: `https://blofy-player-2-0.vercel.app`
- Vercel project: `blofy-player-2-0`
- Git source: the production branch of this repository
- Vercel Root Directory: `services/activation`
- Vercel configuration: `services/activation/vercel.json`
- Database: a dedicated Neon Postgres database connected to the Vercel project
- Android activation base URL: the public origin above, without an API path

Do not create a second production database for routine redeployments. Reuse the existing Neon database so device activation, encrypted playlists and provider profiles remain intact.

## 2. Vercel and Neon environment variables

The activation service reads these exact variable names:

- `DATABASE_URL`: the Neon Postgres connection string. The Vercel/Neon integration may expose several generated connection variables; ensure the service also has the exact `DATABASE_URL` key.
- `BLOFY_ADMIN_TOKEN`: a production-only secret containing at least 24 random characters. Never package it in Android or expose it to the portal.
- `BLOFY_PLAYLIST_ENCRYPTION_KEY`: one stable 32-byte key encoded as exactly 64 hexadecimal characters. Back it up securely. Changing it makes existing saved playlist credentials unreadable.
- `BLOFY_TRIAL_DAYS=7`, unless product policy deliberately changes.

Optional protection tuning variables are documented in `services/activation/.env.example`. Keep their production defaults unless measurements justify a provider-specific change.

Apply the required variables to **Production** and **Preview** when preview deployments are used for end-to-end QA. A local-development value is optional. Leave `PGSSLMODE` unset for Neon/Vercel; `PGSSLMODE=disable` is only for a trusted local Postgres instance. Do not add `PORT` in Vercel—the platform supplies its runtime behavior.

After creating or changing any environment variable, redeploy the project. Existing deployments do not receive changed values retroactively.

## 3. Deploy through Vercel

Production normally deploys from the connected Git production branch. Before merging or promoting:

1. Confirm the Vercel project Root Directory is `services/activation`.
2. Confirm the Neon integration is attached to this Vercel project and `DATABASE_URL` is present.
3. Confirm all required secrets are present in the target environment.
4. Deploy the exact commit that passed Android, activation and FFmpeg checks.
5. Wait for Vercel to report `Ready`; do not promote a deployment with build or runtime errors.

Do not point Android at a preview URL. Preview deployments are for backend/portal QA; the signed production build must use the stable production origin.

## 4. Production health and portal gates

Verify the deployed origin before building or publishing Android:

- `GET https://blofy-player-2-0.vercel.app/health` returns HTTP 200.
- The JSON response contains `ok: true`, `database: "ready"` and `playlistEncryption: "ready"`.
- `GET /` loads the BLOFY portal and the BLOFY logo without a 404.
- Vercel runtime logs show no database initialization or request failures.
- No database URL, admin token, playlist credentials or raw provider URL appears in logs or API error responses.

The database schema initializes idempotently from `services/activation/schema.sql`; do not delete or recreate the Neon database during a normal deployment.

## 5. Activation and playlist smoke test

Run the service smoke test against the production origin or reproduce the sequence manually:

1. New device plus matching six-digit code returns `trial`.
2. Repeating the same device/code preserves the entitlement instead of creating a second trial.
3. A wrong code for an existing device is rejected.
4. Admin activation changes the device to `active` with the requested expiry.
5. Admin block changes the device to `blocked` and Connect is denied.
6. An expired trial/activation returns `expired`.
7. Portal sign-in, playlist save, list, update and delete succeed.
8. A valid `http://` or `https://` provider/playlist URL is accepted; malformed, local/private, `file://` and `ftp://` URLs are rejected.
9. Playlist credentials remain encrypted at rest and are never returned in logs.

## 6. Build Android against production

Build the signed release candidate with:

`-PBLOFY_ACTIVATION_BASE_URL=https://blofy-player-2-0.vercel.app`

The Android client appends `/api/v1/...` paths itself. Do not append `/portal`, `/health` or `/api/v1/activation/check` to the Gradle property.

Also supply the approved Media3 1.6.1-compatible FFmpeg AAR and the production signing identity. Verify:

- application ID is `tv.blofy.player.v2`;
- version is the approved release-candidate version;
- signing certificate matches the pinned production certificate;
- Settings reports FFmpeg as bundled;
- the APK embeds the stable Vercel production origin, not a preview origin.

`tv.blofy.player.v2` is intentionally a clean, independent install beside the legacy app. It is not an in-place update of the legacy package.

## 7. Physical-device QA gate

Test at least one Android TV/box and one Android phone/tablet. For each provider profile test:

- Xtream Live TS and HLS.
- M3U/M3U8 direct streams.
- SD/HD/4K/HEVC where the device supports them.
- AC3/EAC3 and an available DTS-class sample using the FFmpeg build.
- Mini preview to fullscreen transition.
- CH+/CH-, numeric channel entry, EPG and Catch-up.
- Movie resume/start-over.
- Series seasons, episode loading, resume and next/previous.
- Audio/subtitle/quality menus.
- Server switch without losing favorites, locks or watch state.
- Cold app start using local Room data without forced sync.
- Manual refresh and failure recovery without erasing a valid cached catalog.

On terminal playback failure, BLOFY must remain in the app and show its controlled error/retry state. Opening Kodi, VLC, LocalPlayer or the Android app chooser is **never automatic**. The external-player action is available only when the user explicitly selects the manual `خارجي` control.

Record TTFF, buffering count and terminal errors from BLOFY diagnostics for every failed case. Preserve the proven first-live-channel fast path; do not introduce global retries or redirects to solve one provider.

## 8. Production release gate

Do not publish the release candidate until all are true:

1. Android CI, Activation CI and FFmpeg Native CI are green on the same commit.
2. The production Vercel health gate passes against the connected Neon database.
3. Portal add/update/delete passes against production without leaking credentials.
4. The same real-device provider matrix in `ALPHA_QA_MATRIX.md` has no unresolved P0/P1 failures.
5. APK/AAB package, version, signature, FFmpeg ABIs and SHA-256 files are verified.
6. The signed APK is downloaded and installed on a clean device before its link is shared.

If Vercel or Neon fails, roll back/promote the last healthy Vercel deployment and investigate the backend. Never compensate for a deployment problem by changing Android provider or playback rules globally.
