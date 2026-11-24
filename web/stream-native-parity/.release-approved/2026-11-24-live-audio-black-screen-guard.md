# BLOFY STREAM Web 1.0 — Approved Live Black-Screen Audio-Only Recovery
Release date: 2026-11-24 Asia/Riyadh. Merged PR #869, source commit `8ccb1f891900130c763a01c99ac44de2c5275ada`.

## Authorized target
Deploy only official public BLOFY STREAM Web Railway service `f109c5f9-b81d-460d-81e5-175cc9b3df18`, isolated project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
**Do not redeploy** separate media worker `63d4951c-4cda-4879-97cb-01c6700e02c7` (previous approved SHA `8119a790ec301f2f485d0a621fa13e26017ecd96`), customer Android, BLOFY PLAYER, other Railway services, activation, billing or any Xtream settings.

## Root cause / fix
- On TVs/browsers with neither usable frame callback nor frame counters, advancing audio `currentTime` at `videoWidth=0` or `videoHeight=0` could reset `livePlaybackProgress()` indefinitely. The picture might be black while the clock ran normally.
- Do not treat audio-only time progression as **visual** progress until the decoder supplies nonzero video dimensions.
- True presented-frame callbacks remain authoritative even on TV firmware with missing metadata; legacy TVs with actual video dimensions but no frame counters retain time-based fallback.
- The existing 6.5-second HLS diagnostic now distinguishes absent picture from general buffering. The bounded 16-second watchdog invokes existing safe recovery, not a flood of new worker sessions. Avoid restart during user Pause, seeking or a hidden browser tab.
- This is a local Web player improvement. No codec, bitrate, 4K video, HLS upstream, source-auth, FFmpeg `MAX_JOBS=2`, or access-token change.

## Release QA
- New audio-only/real-presented-frame Node regression success; existing 30 lifecycle tests success.
- PR Chrome UI including new closure-isolated helper test: **35/35** browser tests success; official smoke **3/3**, 11-minute audio and 4K static synthetic checks success.
- First Picture, Dual Engine Recovery, FFmpeg Slot Handoff, Live First Playable Segment, Media Backpressure and Encoder Capacity workflows all SUCCESS. Android CI failure unrelated and unchanged.
- No claim that actual STC home Wi-Fi, real subscribed Xtream channels or Toshiba/VIDAA 20-minute field tests passed.

## Rollback
Known-good public Web before upgrade: pinned SHA `d5e81f5fd901210859a98667306101d861292cfe`, Railway successful deployment `14a02417-110e-4fba-85c3-7a1a22283a17`.
