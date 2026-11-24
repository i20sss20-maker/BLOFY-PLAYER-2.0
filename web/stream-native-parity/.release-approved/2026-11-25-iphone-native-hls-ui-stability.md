# BLOFY STREAM Web — iPhone Native HLS Playback and PWA UI Stability

Release approved 2026-11-25 Asia/Riyadh after merging PR #891, merge SHA `43ba2da44bc0a1d02a41273be117ac8b09aea6a2`.

## User reported issue
iPhone Safari playback sometimes freezes/stutters and the web-player controls/layout do not feel native despite 200 responses for 1-second TS segments and frequent live manifest refreshes. The source is genuine user complaint; we do not assert the underlying root cause is confirmed. A 200 HTTP response only certifies successful transport, not decoded video continuity.

## Approved scoped changes
- iPhone-only native HLS live media playlist: optional RFC 8216 negative EXT-X-START hint behind live edge when >=5 media segments and enough buffer; no VOD, desktop, Android, Toshiba/VIDAA or segment edits.
- Detect actual stopped image on native Safari HLS. If paused/hidden/seeking/backoff never modify playback. Attempt at most one in-place live-window resync, with a 45s cooldown, 7.5s grace and confirmed frame progress. Existing bounded recovery remains the fallback.
- Native iPhone video fullscreen controls before viewport fallback; iPhone-only notched safe area and compact portrait/landscape navigation/transport layout. Original Android-inspired controls, logos, screens, other profiles unchanged.
- Preserve one producer and bounded authorized upstream connections, HLS key SIDs, credentials and authentication. No worker/encoder/codec configuration, FFmpeg sessions, product code or customer logins changed.

## Passing CI on PR #891 head `62cef10545e427b76bee239bcc9b558cf1867eb2`
- Official STREAM Web Chrome release QA #45491829588: SUCCESS including dedicated native iOS HLS start and recovery regression suites.
- Fast First Picture #45491829567 SUCCESS; Live First Playable Segment #45491829542 SUCCESS; Live Video Freeze Guard #45491829632 SUCCESS.
- Dual Engine Recovery #45491829573 SUCCESS; VOD Transcode Handoff #45491829604 SUCCESS; Media Backpressure #45491829520 SUCCESS; Encoder Capacity Evidence #45491829766 SUCCESS.
- Independent Android CI #45491829480 failed (no Android source files modified; no Android production release planned).
- **Not yet verified**: uninterrupted real iPhone 20 minute playback, native iOS App Store app, 1:1 ExoPlayer/Media3 compatibility. Safari never uses Android Media3; parity here means Web experience and recovery policies.

## Deployment scope / rollback
- This marker is intentionally under `.release-approved/` so Railway watches it and builds ONLY existing `blofy-stream-web` service (project BLOFY-VIDAA-PREVIEW, service `f109c5f9-b81d-460d-81e5-175cc9b3df18`).
- Do not restart media worker `63d4951c-4cda-4879-97cb-01c6700e02c7`, Android, Xtream, activation, database, or unrelated deployments.
- If live iPhone playback regresses, roll back Web service to prior successful deployment `c2df1627-cf83-4f56-a142-f6a1b65665d2` (commit `586f18f476dc51d4946fecc0a087b5379053bb08`).
