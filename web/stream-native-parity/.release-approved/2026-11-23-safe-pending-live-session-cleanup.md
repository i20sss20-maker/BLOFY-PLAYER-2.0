# Isolated VIDAA preview approval — safe pending HLS viewer cancellation

Scope: BLOFY STREAM Web **experimental Railway preview only**. Does not authorize Android/production customer rollout, does not enable shared-source fan-out and does not change the live Xtream provider.

Reviewed and applied:
- A viewer stopping while the authorized upstream is still opening now cancels its pending SID; no delayed resurrection of a ghost HLS session after an upstream header timeout.
- The pending producer is aborted immediately when the last waiting viewer leaves, but remains active while another authorized viewer still joins.
- Repeated SID joins are idempotent. Fan-out queued viewers are capped along with attached viewers. Live fan-out remains DISABLED by default (`VIDAA_LIVE_SHARE_SAME_BEARER` is unset).
- The authorized settings health panel now displays a bounded numeric count of pending viewers beside active shared viewers and FFmpeg jobs; no account codes, bearer tokens, provider URLs or session IDs.

Verification: GitHub Actions `QA BLOFY STREAM Web Native Parity` run 45263619857 for commit 27e1b30d637b1f76814b533e67acae35fe10bf01 returned SUCCESS: 24/24 media lifecycle tests, 1/1 extended synthetic audio tests, 27/27 Chrome UI tests, synthetic 3840x2160 transport preserved. Worker changes already deployed successfully to the isolated preview at 2026-11-23T20:50Z; this marker triggers the preview-web release watch path.

Known limits: user device real 20-minute Toshiba/VIDAA end-to-end playback, source licensing for fan-out, live service concurrency and actual source failure analysis remain gates. One preview 503 at 20:39:51Z was associated with source-finished/reconnect; adjacent recent web HLS requests succeeded; synthetic testing is not proof of zero buffering on every screen.

Leave PR #804 draft and customer services untouched.