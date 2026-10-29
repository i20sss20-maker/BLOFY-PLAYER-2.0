# BLOFY PLAYER — Code / QR Edition (work in progress)

This is a **separate Android application package** based on the existing player,
not a replacement for the currently released BLOFY PLAYER app.

## What this branch already changes

- Build with `BLOFY_CODE_ONLY_EDITION=true` for package `tv.blofy.player.v2.code`;
  the default build remains `tv.blofy.player.v2` and behaves as before.
- Replace the first screen with an Arabic code-only login and a large QR showing
  the installation-scoped device ID.
- Reuse existing library, TV, movies, series, favorites and playback components.
- Hide the official edition's QR activation, manual playlist management and
  official updater in this edition.
- Do **not** ask customers for upstream host, Xtream username or password.

## Host integration contract — provisional, awaiting the real host

The app needs an **HTTPS authentication gateway reachable from the TV**. The
private content host alone does not necessarily expose a code-login API.
The gateway, not the APK, must safely map short codes to authorized accounts,
enforce expiry and device limits, and return the provider details.

`POST {BLOFY_CODE_AUTH_BASE_URL}/api/v1/code-login`

Request JSON:

```json
{"code":"EXAMPLE-CODE","deviceId":"BLOFY-ABCD-EFGH","appVersion":"2.0.0"}
```

Successful response JSON (schema for integration, *not real credentials*):

```json
{
  "provider": {
    "providerType": "xtream",
    "name": "BLOFY",
    "baseUrl": "https://media.example.invalid",
    "username": "example",
    "password": "example"
  }
}
```

The endpoint path and response will be adapted to the real host when supplied.
Configure with Gradle properties (or a private CI build configuration):

```sh
gradle :app:assembleDebug \
  -PBLOFY_CODE_ONLY_EDITION=true \
  -PBLOFY_CODE_AUTH_BASE_URL=https://auth.example.invalid \
  -PBLOFY_CODE_PAIR_URL=https://pair.example.invalid/connect
```

`BLOFY_CODE_PAIR_URL` is optional. If set, the QR contains its HTTPS URL
with `deviceId` query parameter; otherwise it contains only the non-secret
device ID. **Scanning the QR does not yet sign in**; polling/QR activation
requires the real pairing API. The app does not ship with a production host.

## Must be completed after host/API is provided

1. Verify the supplied private host is an Xtream/media server or an actual
   authentication API. Implement or adapt code resolution accordingly.
2. Add expiring device-bound session tokens, renewal, logout and server
   revocation checks; avoid storing raw login codes.
3. Implement genuine QR approval/polling only if the pairing host supports it.
4. Test unauthorized/expired/revoked codes, incorrect hosts, network loss,
   playback and Android TV remote focus on a signed test APK.

**Important:** An upstream URL included directly in an Android APK can be
extracted. Do not treat an embedded host string as a security boundary, and
never embed host administrator credentials. Only provide media for which users
have valid access rights. No production deployment or APK is claimed by this PR.
