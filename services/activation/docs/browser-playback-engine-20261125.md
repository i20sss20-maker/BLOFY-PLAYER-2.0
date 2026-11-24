# BLOFY STREAM — Browser playback engine (candidate)

## Confirmed customer scope (2026-11-25)
**Movies and series (VOD) work perfectly. Only LIVE channels malfunction:** some devices never start playback and others start then cut out. Do NOT modify VOD routes, seek/resume, movie/series engines, HLS VOD configuration, or catalog. Treat VOD as a regression baseline. Web live-only investigation must isolate MPEG-TS vs live HLS output, device codec capability, browser-specific player support, 503 fanout handoff and media timeouts. Test live start, live 20-minute continuity and two different browsers/devices with the same authorized test feed. Roll out only a live-path fix.


This branch adds **only** `services/activation/web/browser-playback-engine.mjs` plus isolated Node tests. It does NOT change existing Android/iOS APK code or production media routing.

## Research-backed browser strategy
- Prefer HTMLMediaElement native **HLS** where available (notably Safari/iOS).
- Use maintained **hls.js** for HLS on browsers supporting Media Source Extensions.
- Use **mpegts.js** only for explicitly declared raw HTTP MPEG-TS on supported browsers; otherwise request an authorized HLS output at the server. Do not send raw TS into a native HLS player.
- Use native MP4/VOD playback when format/codec checks allow it.
- **Shaka Player** is a future alternative for DRM/DASH scenarios, not a default replacement for all clients.
- **MediaMTX/FFmpeg** are server-side media gateways, not drop-in browser playback engines. They can package/remux authorized TS as HLS, but do not circumvent provider quotas or rights.

References:
- https://github.com/video-dev/hls.js
- https://github.com/xqq/mpegts.js
- https://github.com/shaka-project/shaka-player
- https://mediamtx.org/docs/kickoff/introduction

## Integration contract
The existing authenticated watch page must import `browser-playback-engine.mjs` and call `createBrowserStreamPlayer(video, { Hls, mpegts, onStatus, onDiagnostic })`. The page passes a **short-lived same-origin** route for the signed-in stream, its verified format ('hls', 'ts', or 'mp4'), and a `refresh({signal})` function which re-authenticates and rotates expiring media URLs.

Do not construct provider links or embed Xtream credentials in the page. No passwords, tokens or full URLs may be sent to diagnostics. The backend must return truthful Content-Type, 206/Range for VOD, valid playlists, and safe/authorized segment/key URLs.

## Rollout
1. Identify and integrate the **actual customer watch UI** (there is no video playback element in the marketing `web/index.html`; do not attach there).
2. Validate static syntax, Node tests, and run browser end-to-end tests with a synthetic authorized HLS endpoint.
3. Verify Safari on one failing and one working device, compare HTTP 503 source handoffs and codec behavior, and test a 20-minute continuous session.
4. Only after confirmation, merge to the Railway-connected branch and deploy. **No production rollout is performed by adding this module.**

## Known limits
- The module is a building block, not a finished browser player until wired to the watch page.
- If a feed is HEVC-only and the browser lacks decoding support, a different JS player cannot create codec support; authorized transcoding may be needed.
- Reconnect cannot repair an upstream feed which is permanently offline or has exhausted permitted concurrent connections.
