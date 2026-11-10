# BLOFY STREAM 55.8.7 — Audio QA (not production)
Date: 2026-11-10
Branch: `feature/blofy-stream-55-8-7-audio-intelligence-20261110`

This branch is based on BLOFY STREAM 55.8.7 rather than an earlier BLOFY
PLAYER code version. The stable production APK is unchanged.

## Delivered
- Audio track diagnosis for live STREAM channels: no audio track, unsupported
  decoder, available-but-not-selected audio, app volume muted or selected audio.
- In-player Arabic guidance for missing audio and an optional **تشخيص الصوت**
  button beside the audio selection dialog. Media3 track selection still
  drives actual playback; the new diagnosis never force-restarts the player.
- Local anonymous `BLOFY_AUDIO_HEALTH` logs contain only enum/track counts
  and a short MIME label; not account codes, source URLs or credentials.
- Side-by-side QA package `tv.blofy.player.v2.stream.qa`, preserving the
  current production `tv.blofy.player.v2.stream` installation.

## Blocking acceptance gates
1. Android unit test and streamCodeDemo build pass in GitHub Actions.
2. Identify supported/unsupported audio tracks on Android TV 9 and Android 12+.
3. Confirm real stereo audio output and AC3/E-AC3 compatibility using an APK
   that actually bundles native Media3 FFmpeg decoder libraries if needed.
4. Confirm audio/video switching remains functional on remote D-pad.
5. Verify Play policy, 16-KB native page alignment, release signature and
   versionCode before any production upload. **Do not publish this QA APK**.

The new diagnostic does not by itself add new codecs to devices that lack
them. The existing FFmpeg extension is optional at build time and must be
verified as bundled before claiming those codecs work on Android.
