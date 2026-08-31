# BLOFY PLAYER 2.0 — Media3 FFmpeg native integration

BLOFY's normal CI intentionally builds without the FFmpeg decoder extension. The app is already configured with `DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER`, so once a compatible Media3 FFmpeg decoder AAR is bundled, Media3 can prefer the FFmpeg audio renderer where supported.

## Version lock

The app currently uses **AndroidX Media3 1.6.1**. The FFmpeg decoder AAR must be built from the **same Media3 1.6.1 source/API line**. Do not drop an AAR built against another Media3 version into the app; binary API mismatches can compile and then fail at runtime.

## Why this is not a Maven dependency

`media3-decoder-ffmpeg` is not shipped as a normal Google Maven artifact. It contains JNI/native code and requires a local FFmpeg build with Android NDK/CMake.

## Recommended native build environment

- Linux (recommended for reproducible CI/native builds)
- Android NDK compatible with the Media3 decoder module build instructions
- CMake + Ninja
- FFmpeg source version recommended by the matching Media3 decoder_ffmpeg README
- ABI set required by BLOFY devices; at minimum `arm64-v8a` and `armeabi-v7a`, with x86/x86_64 optional for emulators

## Audio decoders BLOFY should enable

For IPTV compatibility, build the FFmpeg extension with the decoders required by the target services/devices. The typical high-value audio formats are AC-3, E-AC-3, DTS-family where licensing/build configuration permits, plus common fallback formats such as AAC/MP3/Opus/Vorbis/FLAC as appropriate.

Do not enable codecs blindly. Confirm the FFmpeg build/license implications before release distribution.

## Integration into BLOFY

After producing a Media3 1.6.1-compatible decoder AAR, build BLOFY with:

```bash
gradle --no-daemon \
  -PBLOFY_FFMPEG_AAR=/absolute/path/to/media3-decoder-ffmpeg-1.6.1.aar \
  testDebugUnitTest lintDebug assembleDebug
```

If the path is invalid, Gradle fails immediately instead of silently producing an APK without the extension.

When the property is supplied, `BuildConfig.FFMPEG_EXTENSION_BUNDLED` becomes `true`. Without it, normal CI remains unchanged and the field is `false`.

## Runtime behavior

`BlofyPlaybackSession` uses `DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER`. Therefore, when the compatible FFmpeg extension is present, Media3 can load the extension renderer without changing individual Live/Movie/Series screens.

The existing fallback order remains:

1. Media3 playback (with native FFmpeg renderer available when bundled)
2. One retry of the same URL
3. External/VLC/MX fallback when provider policy permits

No global URL route ladder or global header injection should be added as part of FFmpeg integration.

## Release gate

FFmpeg parity is considered complete only after all of the following pass:

- APK builds with the native AAR supplied.
- `BuildConfig.FFMPEG_EXTENSION_BUNDLED == true` in that build.
- AC-3/E-AC-3 problem samples are tested on real Android TV/box hardware.
- No `NoSuchMethodError`/renderer ABI mismatch occurs.
- Existing TS/HLS, subtitles, audio-track switching, resume, and external fallback continue to work.
