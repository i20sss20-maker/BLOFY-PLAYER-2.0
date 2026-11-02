# BLOFY PLAYER — three independent login choices

## User-confirmed choices
- **BLOFY**: NEW dedicated code-login, source host `http://annkel.com:80`.
- **STROING 8K**: previously called “مشتركو BLOFY”, with **original existing** username/password login, original subscriber host and backend settings unchanged.
- **Xtream**: original manual server + username + password form, unchanged.

### What actually exists on this branch
A new BLOFY code gateway in the existing activation backend, with `POST /api/v1/blofy-codes/redeem`.
The Android UI passes a code + existing activated device identity **only** over the BLOFY HTTPS activation base URL. The gateway binds the code to its first eligible device and returns a mapped Xtream account on `http://annkel.com:80`. Android then uses its existing playlist import/caching flow, preserving Media3, VLC, FFmpeg and all playback logic.

The URL supplied by the owner is **an upstream host, not proof of a code redemption API**. This implementation uses **BLOFY-issued codes** that the operator maps to accounts for that host, rather than assuming an undocumented code endpoint exists at annkel.com. The operator must provision authorized host credentials before issuing a usable code.

### Admin workflow
An authenticated owner can use existing `BLOFY_ADMIN_TOKEN` through the HTTPS BLOFY activation service:
- `POST /api/v1/admin/blofy-codes` with `{"username":"<upstream user>","password":"<upstream password>","expiresAt":<optional UNIX milliseconds>}`; returns a fresh random code **once** and a stable provider ID.
- `GET /api/v1/admin/blofy-codes` returns code records and device binding **without** secrets.
- `DELETE /api/v1/admin/blofy-codes/<issued-code>` blocks **new redemptions**, not any already provisioned upstream login.
The admin bearer token must never be stored in the Android app or shown in a client-facing page. Code proofs are keyed HMAC; upstream credentials are sealed AES-256-GCM in Postgres.

### Security / limitations
- **HTTP warning:** `annkel.com:80` is plain HTTP. The BLOFY code redemption gateway itself uses HTTPS, but subsequent upstream Xtream access may expose the upstream credentials on the network. Prefer an authenticated HTTPS origin from the host provider before production launch. No playback / transport engine code was changed.
- Host health and the host-specific Xtream account **have not been verified**. A real authorized test subscription is required.
- Codes remain mapped to the same device; deleting/rotating an app install identity may need an owner-controlled reset/migration mechanism.
- Revoking a code prevents re-redemption; **it cannot invalidate upstream credentials already stored on the device**. Real subscription expiry/revocation must also be enforced by the upstream Xtream provider.
- Backend release is NOT deployed by this PR. A new Android APK/AAB cannot be considered released before backend deployment, CI, physical Android TV remote testing, signing and owner acceptance.

### Acceptance tests
1. Existing STROING 8K login works with previous host and unchanged user/password.
2. Existing Xtream manual login and saved lists are not modified.
3. A BLOFY code can be issued via protected admin API, redeemed on an activated test device and rejected on another device.
4. Invalid/expired/revoked codes fail without clearing existing playlists.
5. Android 9 TV: full D-pad focus for entry, editor keyboard, submission and saved list selection.
6. Actual annkel.com Xtream account imports at least one authorized category and plays using untouched engines.
7. Build on original signed identity; release website and Play only after checks and user acceptance.
