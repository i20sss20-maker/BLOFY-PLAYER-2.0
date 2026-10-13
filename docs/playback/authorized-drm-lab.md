# BLOFY Android / Android TV — authorized DASH + Widevine lab

This is an **opt-in player compatibility change**. It does not provide a playlist,
license, entitlement, DRM bypass or permission to rebroadcast any protected video.

## Changes

- Include the Media3 DASH module, version-matched to existing Media3 1.6.1.
- Detect `.mpd` DASH manifests, including URLs with query strings or fragments.
- Detect explicit `.m3u8` HLS manifests for movies/series as well as live TV.
- Preserve exact input URL and provider-selected TS behaviour.
- Support a valid **HTTPS Widevine license server supplied by the authorized source**
  as an internal, per-item option; reset the option when starting another item.
- No license credentials are checked into the repository. No license URLs are logged
  by the playback session. No extraction or replay of content keys.

## Internal Android integration

A trusted in-app caller with a legitimate license and a licensed media URI may
launch the existing non-exported `PlayerActivity` with:

```kotlin
val intent = Intent(context, PlayerActivity::class.java)
    .putExtra(PlayerActivity.EXTRA_URL, "<licensed DASH MPD or HLS URL>")
    .putExtra(PlayerActivity.EXTRA_KIND, "movie")
    .putExtra(PlayerActivity.EXTRA_TITLE, "Authorized playback test")
    .putExtra(PlayerActivity.EXTRA_WIDEVINE_LICENSE_URL, "<authorized HTTPS license URL>")
context.startActivity(intent)
```

`EXTRA_WIDEVINE_LICENSE_URL` is optional. Unencrypted DASH/HLS streams do not
require it. The intent field is **not** a magic DRM key or a way to access a
subscription without authorization. A license server must grant a valid license
for the device/session, or playback fails as designed.

**Compatibility limits:** An Android device must support the requested DRM
scheme and codecs. Widevine `cbcs` has additional platform requirements, and
the result of a Chrome/Shaka demo is not a device test for the native player.

## Test plan (no external service or paid subscription required)

1. Run `gradle testDebugUnitTest lintDebug assembleDebug` with the repository's
   Android CI configuration (Android API 36, JDK 17).
2. In a **debug build**, open a licensed/official demonstration MPEG-DASH `.mpd`
   from a trusted internal caller; check video, audio, seeking and retries.
3. Repeat with an explicit `.m3u8` movie/episode and an Xtream live TS URL,
   checking no regression in fallback/retry behaviour.
4. With permission to use a Widevine test license, supply its HTTPS URL through
   the internal extra; test startup, buffering, end-of-playback and an item switch
   back to a clear stream (the previous license should not be reused).
5. Confirm that an invalid/http/license-with-userinfo URL is ignored, rather
   than weakening TLS or extracting a decryption key.

## Scope and release status

This change only modifies the Android/Android TV primary codebase
(`i20sss20-maker/BLOFY-PLAYER-2.0`). The archived Android projects are not
the supported distribution channel. Windows source was subsequently located
on the **unmerged Windows development branch** `fix/windows-series-stream-hang-20261008`
(PR #175). It uses **WPF + LibVLC 3.0.24**, not Media3, so this Android PR does
not enable Widevine on Windows. Clear HLS/DASH tests are possible, but licensed
Windows DRM requires a distinct CDM-capable playback design and platform QA.
No production Windows installer has been altered or released.

Keep this as a review branch / pull request until CI and real-device testing
are complete. No production service, public content source or release pipeline
should be changed solely to run this test.
