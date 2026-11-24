# BLOFY STREAM Web 1.0 — Touch-first Mobile Video Player

Approved 2026-11-24 Asia/Riyadh. Merged PR #886, squash commit `ebae4448328ff3fd52b21e3f054929959c71b494`.

## Changes
- Add a mobile/touch-only quick transport toolbar visible over the current player on iPhone, iPad, Android touch: previous channel/previous episode or -10 seconds, play/pause, next channel/next episode or +10 seconds, fullscreen. Existing channel and episode actions are reused; no additional media connection or player engine.
- Tap on the video in touch mode toggles existing HUD visibility. Pending dialogs, retry/errors and manually paused video retain controls. Touch HUD holds for ~6.2 seconds, TV/desktop remains ~3.8 seconds.
- The touch fullscreen control reflects current fullscreen state; iPadOS desktop Safari UA is also covered by the existing native video fullscreen fallback, with viewport-only fallback explicitly preserved if unsupported. Mobile portrait and landscape get readable ~51px+ buttons and safe-area spacing.
- Keep TV remote navigation, existing native playback controls, audio/subtitles/quality and VOD seek logic unchanged. No account, Xtream, server, media worker or extra FFmpeg job changes.

## Verification and caveats
- Official BLOFY STREAM Web browser + remote release QA SUCCESS at PR #886 head `9b6154909f9086d9404053e4e4a8298cfe59f8ed`.
- Dedicated Node touch-gesture and fullscreen/episode/channel QA SUCCESS; first picture, freeze guard, first segment, dual-engine recovery, VOD handoff, backpressure and encoder capacity checks SUCCESS.
- Android CI FAILED independently in Android candidate verification, not relevant to this web-only patch. No Android deployment.
- Still no real-world 20-minute subscriber playback validation on iPhone/Toshiba/VIDAA; HLS native codec and Apple native fullscreen vary by device and must not be claimed as proven.

## Production permission and rollback
- Only deploy production `blofy-stream-web` Railway service `f109c5f9-b81d-460d-81e5-175cc9b3df18`, project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Do not modify or restart `blofy-stream-web-media` `63d4951c-4cda-4879-97cb-01c6700e02c7` or the VOD media pilot, Android, activation, subscriptions, or sources.
- Previous Web rollback SHA `e141772f8eb8b40cb385c1270b0ca35af1968378` deployment `60d477fc-71ff-46c0-9c5c-af0589d4e847`.
