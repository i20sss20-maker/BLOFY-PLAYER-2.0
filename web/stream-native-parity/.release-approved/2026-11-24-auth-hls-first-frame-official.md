# 2026-11-24: official STREAM Web fast HLS cold-start and verified first-frame QoE

Approved to deploy **only** `blofy-stream-web` in Railway environment
`a9a26993-0cec-410d-83dc-2f14a2e47045` under project
`eeff35dc-1754-4f1e-92d7-e28473401453`. DO NOT change Android customer builds or the media worker image.

Change SHA: `033ff6148f64e39e64602333e6c35dc8c302fdc0` (PR #852).
Production Web URL: `https://blofy-stream-web-production.up.railway.app/`.

### Verified changes
- After verified activation/session, modern desktop browsers quietly pre-load first-party HLS JS when idle and before first video request. Old TV, mobile, unauthenticated users and currently playing screens are excluded. Epoch guard prevents stale preload across logout/account switch.
- Startup statistics no longer mark audio-only `playing` as the first displayed video frame. Only a valid presented-frame callback or decoded video counter with nonzero pixel dimensions can establish video first-frame time. Old TVs without those APIs show an unknown time rather than fabricated success.
- First-frame observation timers and callbacks are cleaned up when leaving the player; source/channel switch resets picture metric, and stale old-channel frames are gated until the next channel actually plays.
- No new upstream media requests, new codecs, key material, customer data, FFmpeg conversions or concurrency flags. Existing 2-job worker remains unchanged.

### QA evidence
PR #852: full official GitHub Actions Web job SUCCESS, **34 Chrome interactive cases**, **3 official smoke cases**, **30 media lifecycle tests**, **1 11-minute synthetic audio clock test**, and 5 first-picture/authorized HLS warmup Node assertions. Web dual-engine regression workflow also SUCCESS. Android CI for the draft Android PR remains unrelated FAILED and was not changed.

### Remaining field proof
Physical VIDAA/Toshiba 20+ minute real subscribed stream, natural commentary pitch and concurrent media load were NOT proven by these fixture tests. Never claim universal 100% TV/audio stability. Preserve previous Web deployment for rollback if real playback regresses.
