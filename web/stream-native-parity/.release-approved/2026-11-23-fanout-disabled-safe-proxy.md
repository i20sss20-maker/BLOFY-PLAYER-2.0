# Restricted BLOFY STREAM Web pilot release: backwards-compatible live session proxy

Scope: **web preview only**, no Android customer rollout and no changes to the main BLOFY production Railway project. This marker deploys the web proxy to route an optional random 128-bit viewer SID for authorized live HLS manifests, segments and STOP requests. The worker has already deployed the matching optional paths and synthetic self-tests.

Fan-out is **disabled by default** unless the independent preview worker specifically sets `VIDAA_LIVE_SHARE_SAME_BEARER=1`. Thus this release does not automatically combine streams or change concurrency for existing viewers. Legacy URLs remain valid. When enabled for future authorized pilots, sharing is restricted to identical bearer+channel+audio-track+codec-mode, with a maximum of 4 viewers for one producer and only 2 producer jobs on the isolated worker.

Previous full browser QA `45236246071` (26/26) passed against the viewer-SID web player. Current new fan-out worker unit and browser QA has passed the worker unit step but broader browser run remains in progress as of this marker; do **not** treat this marker as public production readiness. Keep PR #804 draft, source entitlement checks and real 20-minute Toshiba/VIDAA + multi-viewer tests as hard release gates.
