# BLOFY PLAYER 2.0 — Release signing

The production application identity is fixed:

- Application ID: `tv.blofy.player.v2` (installs alongside the legacy BLOFY PLAYER app)
- Key alias: `blofy-release`
- Certificate SHA-256: `7B:18:5B:AE:88:48:C7:15:7A:F2:42:33:59:F7:CD:91:C6:84:16:B8:61:BC:AC:78:87:36:30:80:FE:26:10:2E`

Never commit the private key or either password. The private recovery kit is stored separately and must remain available for every future direct APK update.

## GitHub production environment

Configure these encrypted secrets in the `production` environment:

- `BLOFY_ANDROID_KEYSTORE_BASE64`: base64 of the stable PKCS#12 file.
- `BLOFY_ANDROID_KEYSTORE_PASSWORD`: PKCS#12 store password.
- `BLOFY_ANDROID_KEY_ALIAS`: `blofy-release`.
- `BLOFY_ANDROID_KEY_PASSWORD`: private-key password.

Configure this non-secret environment variable:

- `BLOFY_ANDROID_CERT_SHA256`: the SHA-256 fingerprint above.

Run **BLOFY Signed Release Candidate** from `main`. The workflow fails closed unless the production endpoint, database, playlist encryption, FFmpeg bundle, four Android ABIs, 16 KB native alignment, APK/AAB signatures, and certificate fingerprint all verify.

## Google Play

For the first Play listing, preserve the same app-signing identity if direct APK and Play installations must share update compatibility and the same `ANDROID_ID`-derived BLOFY device identity. Do not accept a different app-signing certificate without explicitly planning a separate distribution channel.
