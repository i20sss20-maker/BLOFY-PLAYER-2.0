# BLOFY Activation — Railway Production Runbook

This runbook deploys the existing `services/activation` service without changing the Android playback core.

## 1. Create the Railway service

Connect the `BLOFY-PLAYER-2.0` repository and set the service **Root Directory** to:

`services/activation`

The repository already contains `services/activation/railway.toml` and `Dockerfile`. With the Root Directory set correctly, `dockerfilePath = "Dockerfile"` resolves to the activation service Dockerfile.

## 2. Add PostgreSQL

Add a Railway PostgreSQL service in the same project. Expose its connection string to the activation service as:

`DATABASE_URL`

Do not hard-code database credentials in GitHub.

## 3. Required environment variables

Configure these variables in the activation service:

- `DATABASE_URL` — Railway PostgreSQL connection string.
- `BLOFY_ADMIN_TOKEN` — a long random production-only secret, at least 24 random characters.
- `BLOFY_TRIAL_DAYS=7` — default first-device trial period unless intentionally changed.
- `PORT` — normally injected by Railway; do not force a conflicting port.

Keep the real admin token only in Railway/secret storage. Never commit it.

## 4. Database initialization

Apply `services/activation/schema.sql` to the production PostgreSQL database before opening the service to real devices. Re-applying schema changes must be reviewed before production use; do not destroy existing device or playlist data.

## 5. Health check

Railway is configured to probe:

`GET /health`

The deployment is not ready until this endpoint returns success consistently.

## 6. Public domain

Generate/attach the Railway public domain and use the HTTPS origin only, for example:

`https://<blofy-activation-domain>`

The Android client appends `/api/v1/...` paths itself. Do not include `/api/v1/activation/check` in `BLOFY_ACTIVATION_BASE_URL`.

## 7. Build Android against production activation

Build the tested Alpha/production APK with the Gradle property:

`BLOFY_ACTIVATION_BASE_URL=https://<blofy-activation-domain>`

For the codec-validation Alpha, also use the FFmpeg-enabled build path so Settings reports FFmpeg bundled.

## 8. Production smoke test

Before distributing the APK, verify in this order:

1. `/health` is healthy.
2. A new device receives a trial state and expiry.
3. The same Device ID with a wrong activation code is rejected.
4. Admin activation changes the device to active.
5. Admin block changes the device to blocked and Connect is denied.
6. Expiry is enforced.
7. Portal device/code login cannot access a different device's playlists.
8. Add/edit/delete/switch playlist changes synchronize with the app.
9. Diagnostics upload/query works without exposing playlist credentials or signed media URLs.

## 9. Alpha release rule

Use the exact Git commit recorded in `docs/ALPHA_QA_GATE.md`. Do not mix an APK from one commit with backend code from another while diagnosing playback or activation issues.

## 10. Rollback

If a deployment fails health checks, roll the Railway service back to the last healthy backend revision. Do not compensate for a backend deployment problem by changing provider playback profiles globally in Android.
