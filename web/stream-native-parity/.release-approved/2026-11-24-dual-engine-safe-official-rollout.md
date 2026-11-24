# BLOFY STREAM Web official 1.0 — dual playback engines / guarded recovery rollout

Date: 2026-11-24 (Saudi Arabia)
Approved target **only**: Railway service `blofy-stream-web` in `BLOFY-VIDAA-PREVIEW` production environment. Public domain: `blofy-stream-web-production.up.railway.app`. Production private worker `blofy-stream-web-media` stays on the previous healthy image; this release changes only frontend browser play routing.

## Changes
- Optional user-initiated, same-origin live MPEG-TS playback using packaged `mpegts.js`. New direct source request is *not opened* until the previous HLS producer acknowledges a 200/404 STOP, limiting unnecessary source connections. User can return to HLS. No new subscriber credentials or arbitrary media URLs.
- Automatic rollback from direct MPEGTS to HLS for decode startup failure, unsupported codec, lost video dimensions or sustained frozen video. Explicit user pause/hidden tab does not falsely trigger recovery.
- Hls.js MPEG-TS remux worker enabled on desktop Chrome/Edge where available; older VIDAA/Hisense/Android 9/Tizen/WebOS/iOS keep prior compatibility path.
- Live sync target reduced conservatively from 5 to 4 segments while retaining 1.00× pitch and bounded buffers. Unknown live and VOD fatal network failures retry after bounded 0.95/1.8/3.6-second pauses, not immediately. Existing 429 capacity, 502 source backoff and 410 live-edge fixes unchanged.
- All session, source, secret and account restrictions unchanged.

## Verified
- PR #849 targeted dual-engine regression tests GREEN, including automatic return and auth-stop ordering.
- Chrome E2E under GitHub Actions tested an actual H.264/AAC transport-stream fixture in `mpegts.js` and verified HLS STOP precedes direct GET; total **33 Chrome browser scenarios passed**, plus three official-release smoke tests, 30 media lifecycle Node tests and synthetic 11-minute audio clock fixture.
- Initial preview and worker remained live SUCCESS. This release does not raise transcoder capacity, share different accounts' source streams or turn on guarded pilot same-bearer fanout.
- Before authorizing large public concurrency, independently verify actual subscribed source >20 minutes on the target Toshiba/VIDAA, live pitch and sound sync, seek and concurrent authorized source load. Automated fixture tests are not that evidence.

## Rollback
Previous known-good Web deployment was `5eb50a88-78a1-4298-80f1-5fce4e7cc8c6` at branch SHA `e9bdb71dbc4b59d20a1835740bd3dea32eb0114e`. Keep the dedicated production worker untouched if browser failures occur.
