# BLOFY FFmpeg native build — Media3 1.6.1

BLOFY uses Media3 1.6.1. The FFmpeg decoder extension must be built from a matching Media3 checkout; do not drop in an arbitrary prebuilt AAR because mismatched Media3 APIs can fail at runtime.

## Pinned inputs
- Media3: `1.6.1` at commit `839c4a90f2ab36e48be73e1b5e907f3283dce72e`
- FFmpeg: `n6.0` at commit `ea3d24bbe3c58b171e55fe2151fc7ffaca3ab3d2`
- Android NDK: `28.0.13004108` (r28)
- Gradle: `8.11.1`
- Host: Linux x86_64
- Android native API level: 21 (Media3 FFmpeg module minimum)
- Decoders targeted for IPTV compatibility: `ac3 eac3 dca truehd mp3 aac vorbis opus flac`

## Official build shape
1. Clone `androidx/media` at tag/ref `1.6.1` and assert its pinned commit.
2. Set `FFMPEG_MODULE_PATH` to `libraries/decoder_ffmpeg/src/main`.
3. Clone FFmpeg `n6.0` under `libraries/decoder_ffmpeg/src/main/jni/ffmpeg` and assert its pinned commit.
4. Apply the generated Media3 patch that pins the verified NDK in
   `common_library_config.gradle` and carries the BLOFY modification notice.
5. Run Media3's `build_ffmpeg.sh` with the pinned NDK and decoder list.
6. Run Gradle 8.11.1 for the `lib-decoder-ffmpeg` release module.
7. Use the produced AAR with BLOFY by passing:

```bash
gradle assembleDebug -PBLOFY_FFMPEG_AAR=/absolute/path/to/media3-decoder-ffmpeg.aar
```

`app/build.gradle.kts` validates the path and exposes `BuildConfig.FFMPEG_EXTENSION_BUNDLED`. `BlofyPlaybackSession` already uses `DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER`, so a bundled FFmpeg renderer is preferred automatically when supported.

## Safety rules
- Do not mix an FFmpeg AAR built against another Media3 version with BLOFY 2.0.
- Keep the normal BLOFY Android CI independent from FFmpeg native compilation.
- Verify AC3/EAC3/DTS-class samples on a real Android TV/box before marking FFmpeg compatibility complete.
- Require `CONFIG_GPL=0`, `CONFIG_NONFREE=0`, and `CONFIG_VERSION3=0`.
- Distribute the generated compliance archive with every FFmpeg-enabled APK/AAB.
- Review codec patent/licensing obligations separately for the intended distribution.

A manual GitHub Actions workflow is provided in `.github/workflows/ffmpeg-native.yml` to produce the pinned AAR as an artifact without affecting normal PR builds.

See `docs/FFMPEG_COMPLIANCE.md` for the source, notice, and relink release gate.
