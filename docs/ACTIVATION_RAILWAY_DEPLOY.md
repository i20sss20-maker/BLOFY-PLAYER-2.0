# BLOFY Activation — Railway deployment

The Android client is already wired to `BLOFY_ACTIVATION_BASE_URL`. The activation service lives in `services/activation` and exposes `/health` plus `/api/v1/activation/check`.

## Railway service
1. Create a new Railway service from this repository.
2. Set the service root directory to `services/activation`.
3. Add a PostgreSQL database to the same Railway project.
4. Railway will use `services/activation/railway.toml` and the local `Dockerfile`.

## Required environment variables
- `DATABASE_URL` — use the Railway PostgreSQL connection string.
- `BLOFY_ADMIN_TOKEN` — generate a long random secret of at least 24 characters. Never commit the real value.
- `BLOFY_TRIAL_DAYS=7` — default trial period.
- `PORT` — normally injected by Railway automatically.

## Initialize database
Run the SQL in `services/activation/schema.sql` against the Railway PostgreSQL database once before production traffic.

## Verify deployment
The public service URL must return HTTP 200 on:

`GET /health`

Then test the Android contract:

`POST /api/v1/activation/check`

with a real BLOFY device ID, six-digit activation code, app version and platform.

## Build Android against the deployed endpoint
Build with the Railway public base URL supplied as a Gradle property:

```bash
gradle --no-daemon \
  -PBLOFY_ACTIVATION_BASE_URL="https://YOUR-SERVICE.up.railway.app/" \
  testDebugUnitTest lintDebug assembleDebug
```

Do not hard-code the endpoint into Kotlin source. Production/release builds should inject the URL during CI/build.

## Admin operations
Admin device endpoints require the `BLOFY_ADMIN_TOKEN` header/credential expected by the service. Keep the token server-side/admin-only; it must never be packaged in the Android application.

## Release check
Before distributing an activation-enabled Alpha:
- `/health` is green.
- A new device receives `trial` with the expected expiry.
- An activated device receives `active`.
- Expired and blocked devices cannot enter.
- Wrong activation code for an existing device is rejected.
- Android offline cached entitlement only works while cached expiry remains valid.
