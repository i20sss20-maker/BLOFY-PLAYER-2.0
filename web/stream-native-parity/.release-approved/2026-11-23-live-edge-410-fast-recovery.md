# BLOFY VIDAA preview release gate — sliding HLS segment 410 and live-edge recovery

**Scope:** isolated web preview `blofy-stream-native-web-parity` and its independent experimental `blofy-stream-web-vod-seek-pilot` media worker. Production customer Android packages, the BLOFY production Railway project and shared subscriber codes are not changed. PR #804 remains draft.

**Observed cause:** the preview web produced a single 504 on a live TS segment at `2026-11-23T20:52:49Z` after >8 seconds, alongside hundreds of successful neighboring live segments. The HLS playlist is sliding and old segments may have already been deleted.

**Change:** the worker recognizes a missing live segment with a sequence number older than the current HLS media sequence and immediately returns 410 Gone instead of waiting 8 seconds. This is distinct from upstream 502/503/504 failures and does not restart a healthy encoder. An Hls.js live player handles this 410 by stopping the stale fragment request and resuming near the live edge; recovery attempts are throttled and limited, with a normal reconnect fallback. Source disconnect circuit breaker and fan-out opt-in remain unchanged.

**Verified:** GitHub Actions `QA BLOFY STREAM Web Native Parity` run 45268106854 finished SUCCESS for branch commit 3d1d91c34f39ba61f59cdcc99d63af49be14b609: 28/28 media lifecycle tests, 1/1 extended audio test, 27/27 browser/UI tests, plus synthetic UHD 3840x2160 TS verification. The media worker already deployed the change successfully to the preview (`cb806116...`). This approval marker triggers preview web deployment only.

**Restrictions:** Fan-out still disabled by default (`VIDAA_LIVE_SHARE_SAME_BEARER` absent). Real 20-minute Toshiba/VIDAA physical-device and multi-viewer stream tests with authorized content remain required before recommending public rollout. Never describe these browser/synthetic checks as hardware certification.
