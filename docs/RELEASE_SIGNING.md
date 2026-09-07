# BLOFY PLAYER 2.0 — Release signing

The production application identity is fixed:

- Application ID: `tv.blofy.player.v2` (installs alongside the legacy BLOFY PLAYER app)
- Key alias: `blofy-release`
- Certificate SHA-256: `C3B98CCCD2F0C86809014ACD9368BF61C7004CFD419CD867B71FEF10BFA6255E` (verified by RC07 Signed Release #257)

Never commit the private key or either password. The private recovery kit is stored separately and must remain available for every future direct APK update.

## GitHub production environment

Configure these encrypted secrets in the `production` environment:

- `BLOFY_ANDROID_KEYSTORE_BASE64`: base64 of the stable PKCS#12 file.
- `BLOFY_ANDROID_KEYSTORE_PASSWORD`: PKCS#12 store password.
- `BLOFY_ANDROID_KEY_ALIAS`: `blofy-release`.
- `BLOFY_ANDROID_KEY_PASSWORD`: private-key password.

Run **BLOFY RC07 Signed Release** (`.github/workflows/rc07-release.yml`) from `rc07-commercial-stability`. Pushes to that branch also dispatch the workflow automatically. The workflow pins the fingerprint above as `EXPECTED_CERT_SHA256` and rejects other branches. Keep this guard and the existing signing material intact.

The workflow fails closed unless the production endpoint, database, playlist encryption, FFmpeg bundle, four Android ABIs, 16 KB APK alignment, APK/AAB signatures, and certificate fingerprint all verify. Its output is an Actions artifact; it does not publish to Google Play.

The historical accepted device-test baseline is `2.0.0-rc07.9` / `2000017`, commit `72434a500946286b84e9c779fb44e02d6052144c`. The owner has authorized integration of audit PR #36 and preparation of `2.0.0-rc07.10` / `2000018` for device testing. Both Android version fields and the workflow expectations/artifact names now identify this candidate; its signed release has not yet been verified.

Before delivering the candidate, pass Android and activation CI plus the existing signed release checks. Preserve the pinned signing certificate and verify installation over rc07.9 without clearing data during device acceptance. Audit PR builds alone are not approved device releases, and the commercial release still requires real-device approval.

## Google Play

For the first Play listing, preserve the same app-signing identity if direct APK and Play installations must share update compatibility and the same `ANDROID_ID`-derived BLOFY device identity. Do not accept a different app-signing certificate without explicitly planning a separate distribution channel.
