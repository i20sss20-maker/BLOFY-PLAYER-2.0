# BLOFY STREAM WEB isolated preview – verified read-only live session dashboard

Approved scope: `blofy-stream-native-web-parity` service in isolated `BLOFY-VIDAA-PREVIEW` Railway project only. The Android production services and paying clients remain untouched.

Shipped features: Settings -> اتصالات البث ومشاركة المصدر. Authenticated, read-only status displays whether guarded shared-source pilot is enabled, viewer group count, viewer count and active decoder jobs/capacity. No subscriber credentials, hosts, source URLs or stream contents are exposed. Operator can test diagnostics without starting a video or enabling shared streams.

The media worker's guarded same-bearer fan-out is **DISABLED BY DEFAULT** because service variable `VIDAA_LIVE_SHARE_SAME_BEARER` is absent. This release does not increase source concurrency or assert a 4K playback guarantee.

Verification: GitHub Actions QA BLOFY STREAM Web Native Parity run 45249787477 for b63ab7cecf600a9fdec0f20e8158c45a5c41933f returned SUCCESS: 23/23 lifecycle unit tests; 1/1 long-audio synthetic tests; 27/27 browser/UI tests, and synthetic 3840x2160 transport verification. Existing preview service and media worker deployments succeeded. Required before enabling fan-out: authorized real-content source permission, repeated 20-minute Toshiba/VIDAA playback, two simultaneous accounts/devices tested and measured source CPU/network, plus quick rollback. Keep PR #804 draft.

This marker intentionally triggers the preview web service's GitHub watch-path after CI passed. It does not deploy changes to any subscribed Android applications.
