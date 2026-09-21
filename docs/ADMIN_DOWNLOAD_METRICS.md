# Admin download metrics and incomplete registrations

The main `/admin` dashboard separates registered device IDs from website download
requests. A pending registration is an expired database placeholder with
`trial_registration_pending=true`; its trial has not started. Reported app version
and platform can show app contact even when the required trial scope is missing.
Pending rows are not counted as expired subscriptions. No existing device rows
are removed or automatically granted activation by this change.

## Download definitions

- Requests: existing `blofy_download_stats` GET counts, including retries and
  incomplete attempts. History remains unchanged.
- Full files: exact advertised bytes, upstream EOF and successful HTTP response
  finish. HEAD, errors, cancellation, truncation, unknown lengths and separate
  partial ranges do not count. A single range covering the whole file counts.
- Today: full BLOFY files for the current calendar day in `Asia/Riyadh`.
- Measurement start: persisted when the new completion schema is initialized.
  Historical requests cannot be reconstructed as completed downloads.

These are server delivery counts, not distinct people, confirmed installations or
proof that a client saved the file. Repeated complete downloads count again.
Direct downloads from GitHub or Google Play bypass the website measurement.
No IP addresses, cookies or device fingerprints are collected for these metrics.

Activation and download distribution share the Azure PostgreSQL database. The
authenticated usage endpoint exposes aggregates only. Missing metric tables are
shown as unavailable, and a failed metrics read does not prevent device management.

## Verification

`node --test services/update-distribution/download-metrics.test.mjs` checks full
HTTP streaming and exclusion cases. Activation tests cover authorization, missing
data, structured pending UI states and aggregate semantics. Device Administration
CI runs the real PostgreSQL/HTTP integration in `test/device-admin-runtime.mjs`.

Unit-test Gradle invocations use `http://127.0.0.1:9` for activation and updates,
separately from production build invocations, so Robolectric application startup
cannot register fixtures on the customer service. The active rc07.55 Android
branch receives the same workflow isolation separately.

The published APK remains `2.0.0-rc07.55`, version code `2000067`, SHA-256
`40f70c4447b7a570e63b71181d56b6e5591959a58d63137161cef55f903ba55f`.
