# BLOFY experimental DASH / Widevine playback (internal QA)

This change is a **development-only playback capability**, not a content source and not a release.

## What changed
- Media3 DASH module added alongside existing HLS / TS support.
- Explicit `.mpd` and `.m3u8` URLs are recognized for live, film and episodes, regardless of URL query strings.
- A provided HTTPS Widevine license URL can be attached *optionally* to a Media3 `MediaItem`, using
  `PlayerActivity.EXTRA_WIDEVINE_LICENSE_URI`. The activity is not exported, so another application
  cannot use it as a license relay. Existing content flows do not supply a license by default.
- The license URL is never written to persistent settings or user-facing diagnostics.
  Malformed / insecure / embedded-credential license endpoints are ignored.

## Test plan
1. Run the Android CI unit tests, lint and debug build on this branch.
2. On a physical Android/Android TV device, try a **permitted clear DASH** sample and a permitted HLS sample.
3. From a trusted in-app QA caller, supply an **authorized** HTTPS Widevine license endpoint to
   `PlayerActivity.EXTRA_WIDEVINE_LICENSE_URI` for an authorized `.mpd` stream.
   Test playback, expiry, invalid token, seek, resume, and source switch (no token retention).
4. Run 20–30 minute stream soak tests and validate that error logging redacts sensitive URLs.
5. Verify Xtream TS/HLS playback remains unchanged.

## Limits / outstanding work
- This does **not** provide licenses, content, channels or DRM decryption keys.
- Proprietary DRM playback depends on real entitlements, the device CDM and source protection scheme.
  Widevine is not available on every Windows/browser configuration; this Android change does not modify Windows.
- Authorization headers, license refresh, PlayReady/ClearKey and provider-specific integration are not included.
- Debug CI APK is **not a production update**: release signing, QA and approval are required.
- Do not configure unlicensed or unauthorized sources or use this as a restreaming service.
