# BLOFY STREAM Web 1.0 — Local Live Playback Cause Hints

Release approval: 2026-11-24 Asia/Riyadh. Merged PR #875, source commit `611367f74fdeede2ea3f6ce0112e6344e79b2f6d`.

## Scope
- Existing live video health panel and private diagnostic snapshot now use the same read-only local evidence classifier. It distinguishes recent encoder-slot 429 events, media-path 502–504 replies, HLS media decode errors, arriving HLS fragments with stalled picture, stale HLS fragments, missing picture dimensions, first-video startup, and unknown/native HLS cases.
- Every reason is a hypothesis, NOT a determination that source, network, router or decoder is at fault. A healthy recovered picture overrides older failure events. Paused, hidden, and seeking playback are excluded.
- No extra media fetches, remote telemetry, URL/host/account identifiers, customer logs, playback engine changes, subscription changes, or FFmpeg capacity changes.

## Verification and limits
- PR #875 official Web browser/release QA SUCCESS; separate Node VM classification tests SUCCESS.
- Live first playable segment, first picture, video freeze guard, dual-engine recovery, VOD worker handoff, media backpressure and encoder-capacity evidence QA SUCCESS.
- Android CI failed independently on Android manifest/TV verification; this is a web-only change and must not trigger Android deployment.
- NO real subscriber 20-minute Toshiba/VIDAA/STC WiFi field acceptance has been performed.

## Authorized deployment only
- Railway project BLOFY-VIDAA-PREVIEW `eeff35dc-1754-4f1e-92d7-e28473401453`, production environment `a9a26993-0cec-410d-83dc-2f14a2e47045`, service `blofy-stream-web` `f109c5f9-b81d-460d-81e5-175cc9b3df18`.
- Do not restart separate `blofy-stream-web-media` `63d4951c-4cda-4879-97cb-01c6700e02c7` or touch Android, activation, billing, Xtream, BLOFY PLAYER.
- Prior successful Web deployment: `c5279c48-dd6f-4481-be14-4050d62b3627`, SHA `bc286b20c9c48e7b769a1acba353297b86d2387d`. Roll back only the Web service if needed.
