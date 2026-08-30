# BLOFY FFmpeg native build — Media3 1.6.1

BLOFY uses Media3 1.6.1. The FFmpeg decoder extension must be built from a matching Media3 checkout; do not drop in an arbitrary prebuilt AAR because mismatched Media3 APIs can fail at runtime.

## Pinned inputs
- Media3: `1.6.1`
- FFmpeg: `release/6.0`
- Android NDK: `26.1.10909125` (r26b)
- Host: Linux x86_64
- Android ABI API level: 23 (BLOFY minSdk)
- Decoders targeted for IPTV compatibility: `ac3 eac3 dca truehd mp3 aac vorbis opus flac`

## Official build shape
1. Clone `androidx/media` at tag/ref `1.6.1`.
2. Set `FFMPEG_MODULE_PATH` to `libraries/decoder_ffmpeg/src/main`.
3. Clone FFmpeg `release/6.0` under `libraries/decoder_ffmpeg/src/main/jni/ffmpeg`.
4. Run Media3's `build_ffmpeg.sh` with the pinned NDK and decoder list.
5. Run Gradle for the `lib-decoder-ffmpeg` release module.
6. Use the produced AAR with BLOFY by passing:

```bash
gradle assembleDebug -PBLOFY_FFMPEG_AAR=/absolute/path/to/media3-decoder-ffmpeg.aar
```

`app/build.gradle.kts` validates the path and exposes `BuildConfig.FFMPEG_EXTENSION_BUNDLED`. `BlofyPlaybackSession` already uses `DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER`, so a bundled FFmpeg renderer is preferred automatically when supported.

## Safety rules
- Do not mix an FFmpeg AAR built against another Media3 version with BLOFY 2.0.
- Keep the normal BLOFY Android CI independent from FFmpeg native compilation.
- Verify AC3/EAC3/DTS-class samples on a real Android TV/box before marking FFmpeg compatibility complete.
- Review FFmpeg codec licensing for the intended distribution before release.

A manual GitHub Actions workflow is provided in `.github/workflows/ffmpeg-native.yml` to produce the pinned AAR as an artifact without affecting normal PR builds.
