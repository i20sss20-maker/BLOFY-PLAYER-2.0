# BLOFY PLAYER 2.0 — Project Memory

Last updated: 2026-09-01
Repository: `i20sss20-maker/BLOFY-PLAYER-2.0`

## Product direction

BLOFY PLAYER is a native IPTV player focused on Android/Android TV first, with support for Xtream Codes and M3U/M3U8 playlists. The current visual identity and theme are approved and should not be changed unless explicitly requested. The main work should focus on playback reliability, speed, remote navigation, large-server handling, movies/series polish, and preserving the existing working engines.

## Approved UI direction

- Keep the current BLOFY visual identity and approved theme.
- Live TV, Movies, and Series should use the approved modern layout.
- Movies and Series should not show the left home navigation menu on the content/detail view.
- Movie/series posters should use the available screen space cleanly.
- Add/keep Resume playback for Movies and Series.
- Movies/Series full-screen playback must expose subtitles, audio tracks, and related controls.
- Live TV full-screen playback should stay simpler and avoid unnecessary movie/series controls.
- Remote/D-pad navigation must be stable, fast, and predictable.
- Large playlists/servers must load without long stalls, repeated reloads, or freezing around 95%.
- Server ordering should follow the server's own ordering when possible.
- The app should support many UI languages.

## Playback priorities

Do not replace or destabilize playback components that are already known to work. Current direction is to improve compatibility and fallbacks rather than redesign the playback stack from scratch.

Important playback goals:

- Fast startup for Live TV, Movies, and Series.
- Reliable playback across different IPTV servers.
- 4K / HEVC support.
- Media3 as a core playback path.
- FFmpeg audio decoder extension for broader codec support.
- Preserve fallback strategies where already implemented.
- Warm/fast channel switching where practical.
- Correct subtitles and audio-track selection for VOD/series.

## FFmpeg native build status

The repository contains a native Media3 FFmpeg build workflow at:

`.github/workflows/ffmpeg-native.yml`

The build is pinned to:

- Media3: `1.6.1`
- FFmpeg: `n6.0`
- Android NDK: `28.0.13004108`
- Gradle: `8.11.1`
- Android native API: `21`
- ABIs: `armeabi-v7a arm64-v8a x86 x86_64`
- Default audio decoders: `ac3 eac3 dca truehd aac mp3 opus vorbis flac`

The workflow builds the FFmpeg decoder AAR, builds the BLOFY APK with that AAR, verifies the decoder is packaged for all Android ABIs, runs zipalign verification, checks native ELF alignment for 16 KB page-size compatibility, validates compliance files, and uploads APK/AAR artifacts.

## Latest CI issue and fix

A GitHub Actions run reached the final native verification phase successfully, including APK creation and zipalign verification. It then failed while checking `lib/arm64-v8a/libffmpegJNI.so` with this condition:

`llvm-readelf -h <library> | grep -Eq 'Class:[[:space:]]+ELF64'`

The APK already contained the expected FFmpeg libraries and zipalign verification had succeeded. The failure was in the header text-matching check, not in the FFmpeg build itself.

The workflow was updated to make the ELF64 check less sensitive to label formatting/localization:

`llvm-readelf -h "$library" | grep -Eq 'ELF64'`

Latest fix commit:

`239a89c1440a12af72f882dc30b6b6ae380f366a`

Commit message:

`ci(ffmpeg): make ELF64 header verification locale tolerant`

## Important development rule

Before making major playback changes, compare against the latest known-good build and avoid changing unrelated UI/theme code. When a regression appears, isolate whether it comes from playback, playlist parsing/loading, server compatibility, remote focus/navigation, or build/packaging rather than rewriting multiple areas at once.

## Next practical step

Run the `BLOFY FFmpeg Native` workflow again after commit `239a89c1440a12af72f882dc30b6b6ae380f366a`. If the workflow passes, use the generated FFmpeg-enabled APK artifact as the next test build and verify:

1. Live TV across all previously problematic servers.
2. Movies across the same servers.
3. Series and episode playback.
4. Audio on AC3/EAC3/DTS/TrueHD sources where available.
5. 4K/HEVC playback.
6. Startup delay and channel-switch delay.
7. Remote/D-pad movement and focus.
8. Large playlist loading and cached reload behavior.

## User testing philosophy

Prefer real-server testing over assumptions. Test at least three different servers when evaluating playback fixes because one server working is not enough to prove compatibility. Keep working UI and engines untouched unless a confirmed bug requires a focused change.
