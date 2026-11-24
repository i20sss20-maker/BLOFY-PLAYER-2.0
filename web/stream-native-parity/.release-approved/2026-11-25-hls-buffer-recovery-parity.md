# BLOFY STREAM Web — Verified Live Buffering Recovery and Android-inspired READY Behavior

Release approval: 2026-11-25 Asia/Riyadh. PR #890 merged source commit `18ab1a43b8726b8d6e9f2894e500a7e5884f2fd7`.

## Confirmed issue and remediation
The Web HLS/MPEG-TS/MP4 handling previously surfaced a "جار تعبئة مخزن البث" message immediately for every `waiting`/`stalled` DOM event. Repeated waiting events could cancel and postpone the 8.5-second HLS stall recovery timer; resuming visual playback on Safari/VIDAA without a new `playing` event could leave a stale overlay and miscount buffering duration.
- Guard native HLS / Hls.js waiting notice behind 1.9s grace and concrete video picture state. Cancel it on verified frame/time progress, genuine `playing`, pause, seek, background tab or superseding recovery; never hide unrelated source/decoder errors. Keep existing independent 2.2s visual-progress watchdog and 16s stuck-frame recovery.
- Coalesce repeated waiting events: do **not** extend the bounded 8.5s + 14s HLS recovery deadline. Honor the existing 429-capacity and 502/503/504-source network retry backoff rather than issuing redundant restarts.
- Native MP4 gets 1.7s waiting notice, non-resettable 14s genuine-stall check and resume-on-timeupdate clearance. Direct MPEG-TS waiting deadline no longer resets when the browser repeats events.
- Close local quality-of-experience buffer duration on actual picture progress even when the browser omits a matching `playing` event.
- Correctly shut down new wait timers when switching channels, closing the player or logging out; do not create extra HLS sessions, new FFmpeg jobs or upstream work.
- Android Media3 is native, so it cannot simply be installed inside Safari or VIDAA. This is **behavioral parity**: Android `STATE_BUFFERING`/ `STATE_READY`, bounded recovery and real picture evidence using browser-native HLS or Hls.js. No false claim of codec/decoder identity.

## Evidence and approvals
- Official Web Release 1.0 Chrome browser + TV remote workflow SUCCESS: run `45488899203`, PR #890 final head `7dafe58154616e25bf9f7e0ddeedb142a4ceed55`.
- New Node isolated tests verify coalesced waiting, pause/hidden/seek/backoff, real frame recovery, status ownership, native MP4/MPEG-TS timers and QoE buffer time; official Web test PASS.
- Same SHA: Fast First Picture, Live First Playable Segment, Live Video Freeze Guard, Dual Engine Recovery, VOD Transcode Handoff, media backpressure/capacity, and encoder-capacity evidence workflows SUCCESS.
- Android CI failed independently: Android candidate checks not in scope; no Android APK, project or native build deployment.
- Railway Web and media worker were online before release: 0 critical, 0 warning. Recent Web HTTP sample: 140 successful 200s, 1 aborted 499, 1 unauthorized 401, and 3 404s; **not** a guarantee that upstream sources are always healthy.
- No long physical customer acceptance run (20-minute iPhone, Toshiba/VIDAA or STC Wi-Fi) has been completed: real-world uninterrupted playback NOT proven.

## Scope, rollback and deployment
- Deploy **only** the existing Railway `blofy-stream-web` service `f109c5f9-b81d-460d-81e5-175cc9b3df18` in `BLOFY-VIDAA-PREVIEW` project `eeff35dc-1754-4f1e-92d7-e28473401453`, production environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Never restart or redeploy separate `blofy-stream-web-media` `63d4951c-4cda-4879-97cb-01c6700e02c7` or VOD pilot, Android app, payment, activation, PostgreSQL, customer credentials or Xtream upstream.
- Web-only rollback if needed to approved commit `dcecba8817b9f2cecc248b183371b2b41dc2bd71` and Railway deployment `6178cbae-e6a5-438a-91f8-23a643356c16`.
