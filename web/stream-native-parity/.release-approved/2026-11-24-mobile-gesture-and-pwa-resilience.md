# BLOFY STREAM Web 1.0 — Mobile Resilience and Gesture Release

Production approval on 2026-11-24 Asia/Riyadh. Merged PR #887, source squash `b1bd2fcdbe5c5930e537e8f6628c5d2f4eb7e8f2`.

## Precisely scoped user-facing improvements
- Touch VOD/series video recognizes **two deliberate taps** near one another within 45–340ms on the same outer third of the actual picture: left rewinds 10s, right seeks +10s using the existing debounced seek engine. No seek on live TV, center taps, paused video, open dialogs, unsupported/missing video, invalid screen width, excessive finger movement or double-tap delay. On-screen brief accessible +/-10s badge.
- Installed PWA shell v5: detect the service worker actually replacing an earlier controller; offer an explicit update button on a non-player screen. Never automatically reload, and hide update prompt during playback. Coalesce non-player update checks to at most once each 30 minutes and suppress when the browser reports offline. Preserve current no-cache policy for API, video, accounts, subscriptions and Xtream.
- Browser connectivity advisory distinguishes loss/restoration of **local device network according to the browser**, without claiming a source outage or restarting video. Remains private; no new telemetry or media requests.
- Existing iPhone/Android touch controls, Toshiba/VIDAA/remote behavior, VOD pause/resume, HLS/MPEG-TS recovery, account auth, and media worker limits remain unchanged.

## Validation
- Official Web 1.0 release Chrome+remote workflow **SUCCESS** at PR #887 final head `4ac4ed6b0c68782bb924f79f24e6ef054647abb4`, including 35+ existing browser tests and new real Chrome offline/double-tap test.
- Dedicated Node regression for bounded gesture, first-tap/center/live exclusion, offline truth, update safety **SUCCESS**; iOS PWA installation icon QA **SUCCESS** with new shell-v5 check.
- Media first picture, first segment, freeze guard, dual-engine recovery, VOD transcode handoff, encoder capacity/backpressure **SUCCESS** on the same PR head.
- Separate Android CI still **FAILURE** on Android-specific checks; NO native Android code/build/release authorized by this Web change.
- No 20-minute subscribed iPhone, Toshiba/VIDAA or STC Wi-Fi field acceptance. The release does **not** certify uninterrupted consumer playback.

## Safety, scope and rollback
- Deploy ONLY existing Railway `blofy-stream-web` service id `f109c5f9-b81d-460d-81e5-175cc9b3df18`, project `BLOFY-VIDAA-PREVIEW` id `eeff35dc-1754-4f1e-92d7-e28473401453`, production environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- DO NOT redeploy or restart `blofy-stream-web-media` (`63d4951c-4cda-4879-97cb-01c6700e02c7`) or VOD seek pilot; do not alter Android, Xtream, activation, billing, customer sources, subscriptions or worker capacity.
- Immediate rollback only Web service to prior successful commit `2817ee68b1cb3eedcfbdb9fba0c092381950bb1f` (Railway deployment `afa9962c-2135-4c0b-a50c-ea581ca176cd`).
