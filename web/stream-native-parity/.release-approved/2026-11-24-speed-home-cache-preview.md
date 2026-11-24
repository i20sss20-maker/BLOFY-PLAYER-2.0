# 2026-11-24 — STREAM Web speed preview: instant home / bounded catalog TTL

Deploy only to isolated `BLOFY-VIDAA-PREVIEW/blofy-stream-native-web-parity`. Preserve customer Android, activation portal, PostgreSQL, Xtream source and video-transcoding worker untouched. Review commit `3d513fc8debfbef5d7f8e1e7d9d4bb3b6b32ec51` (PR #844) + bugfix `1631efe9f83af9c0467dcb8646a8075318a2ac62`.

## Verified improvements
- Render home shortcuts + existing continuation immediately instead of waiting for both movie and series first-page downloads; independently add shelves as their upstream results arrive.
- Re-render now restores active TV focus using unique shortcut IDs, plus current home scroll, without touching the playback screen.
- Eager prioritized hero image, all other poster artwork remains lazy.
- Short-lived first-party **per-bearer HMAC-scoped** memory cache of bounded browse page results only, TTL 45 seconds, max 40 entries, max 160KiB each. No data on disk or shared CDN; all endpoint responses remain no-store. Exclude media, activation, search results, API tokens and login state.
- Settings refresh now bypasses the short cache explicitly with fresh=1. Old playback, D-pad, media choices, source order and API contracts unchanged.

## Verification
- PR #844 dedicated performance tests: SUCCESS.
- Full isolated Chrome UI regression on latest preview feature commit `1631efe9f83af9c0467dcb8646a8075318a2ac62`: **32 passed**; 30 media lifecycle and 1 long-audio synthetic tests passed; UHD H.264 fixture passed. A Chrome regression intentionally delayed series catalogue until after movies while testing home painting and remote focus.
- The first Chrome run exposed a real focus-jump issue with duplicate `data-go` controls; fixed and green before this marker.
- Cache speeds repeated browsing while hot, but does NOT change the first-ever upstream large catalogue scan or actual video bitrate/capacity. No measurement-based real-world % speedup or 100% TV compatibility is claimed.
- Physical Toshiba VIDAA/live authorized >20 min video+audio validation and production capacity tests still gate customer rollout; existing PR #804 remains DRAFT.

Revert to prior verified web deployment if live preview media/session regression occurs. Separate worker's TS continuity pilot remains OFF.
