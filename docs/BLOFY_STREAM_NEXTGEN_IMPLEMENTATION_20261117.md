# BLOFY STREAM — NEXT GENERATION
## Engineering execution register · 17 November 2026

**Active QA candidate:** 55.8.34 (versionCode 2000111), `tv.blofy.player.v2.stream`.  
**Baseline:** exact owner-signed 55.8.33 stream source; **do not merge or overwrite public/customer app** until physical QA.

This is a **feature implementation register**, not a claim that every feature is finished.

### 0. Non-negotiable safety and compatibility
- Never change BLOFY PLAYER's package, customer install/update endpoint, activation records or subscription codes as part of STREAM work.
- Respect source permissions and content rights; only download or stream content users are authorized to access.
- Keep the same player, validated playback URLs and original-owner signing key; verify SHA-256 certificate and app ID in CI.
- Keep Android 9 and Android TV/box D-pad operable. Do not require touch, mouse or software keyboard for ordinary watching.
- Changes go through an isolated draft PR, Android unit tests, build, signed **private QA** artifact and physical TV smoke test before public deployment.

### 1. Current code changes (NEXTGEN phase 1)
| Area | Implemented in code | Acceptance check |
| --- | --- | --- |
| Live TV / Search | Independent channel and search windows; DPAD list navigation via shared `TwoPaneFocusGuard`, deliberate UP transitions to tabs/search | Channel 1 -> 2 -> open Channels; selected row focused. Search never opens from arbitrary DPAD. |
| Back/navigation | Search BACK returns to originating Channels; opening remote key-up cannot click first row | No double action; TV remote OK/MENU/SEARCH/BACK distinct |
| Home | On return from playback refresh only watch-history shelves, not all posters/hero | No home screen flicker or jump to search while last poster exists |
| Series | Process-local provider/series-scoped season+episode focus checkpoint with 30m expiry and bounded cache | Back from episode playback selects same episode, not season 1 |
| Downloads | Robust missing/failed file action, overflow-safe percentage | Missing file opens clear recovery dialog, never tries invalid playback |
| Catalog | Existing manual refresh 95% final-commit timeout/recovery retained from baseline | Old committed catalog usable after interrupted refresh |

### 2. Physical acceptance matrix (required — NOT yet proven)
1. Android 9 box, recent Android TV: boot, code login, no date dependency, content navigation via D-pad in Arabic/English.
2. BLOFY1 -> BLOFY2 -> MENU: focus back on BLOFY2; DOWN repeats smoothly, UP stops at real tabs (not search), RIGHT reaches audio controls.
3. Search button and SEARCH remote key open separate window; keyboard only appears there. Search in Arabic and English, BACK to original Channels window, choose result and play.
4. Leaving player returns to last highlighted channel after asynchronous first-page load. No UI flicker on returning Home.
5. Movie and series library: seasons, episodes, resumable playback, favorites and offline download allowed sources; test missing download file recovery and space errors.
6. Audio: FoXFM / Anes source-specific tests with *authorized* accessible URLs; original audio fallback and sync offsets; video must continue. No promise of universal audio recovery.
7. 95% catalog refresh: old catalog remains visible on timeout/cancel; fully committed changes are atomic.
8. Startup/scroll metrics: test on low-RAM device, 720p and 1080p TV, hot/cold launches.
9. Release: signed certificate SHA-256 matches owner, versionCode grows monotonically, no private credentials in logs or APK source, no silent auto-update.

### 3. Remaining workstreams (not silently marked complete)
| Priority | Workstream | Planned deliverable | QA gate |
| --- | --- | --- | --- |
| P0 | Playback engine stability | Network error taxonomy, bounded retries, codec/audio diagnostics, player session state | Real live/VOD smoke, dropped Wi-Fi, no duplicate sessions |
| P0 | TV focus and UX | Unified focus contract for all screens (Home, details, series, settings, player), accessibly labelled buttons | Key matrix in Arabic/English on Android 9 |
| P1 | Home/theme | One design-token system, responsive cinematic hero/shelves, cache-aware image loading | Frame stability and accessibility |
| P1 | Series/movie | Better episodes pagination, watch progress, and details actions (Watch/Favorite/Download only) | Click actions and back-return regressions |
| P1 | Downloads | Network/storage queue; retry direct authorized files; ongoing display without stale rows | Wi-Fi suspension, file corruption, storage loss |
| P1 | Catalog | Incremental sync when provider supports it, durable checkpoint UI, last-success and last-error counters | Large 100k+ item source, interruption recovery |
| P2 | AI chat | Authenticated AI gateway with verified local catalog IDs, no invented streams, private rate limits | Accuracy + catalog match + privacy |
| P2 | Profiles | Profiles and optional parental controls subject to correct server identity/security | Profile isolation and logout wipes secrets |
| P2 | Admin | Observability, rollout flags, version channels, source health aggregates | Privacy-safe telemetry, rollback drill |
| P3 | Multi-view / PiP | Device-supported features with stream concurrency caps | Device and source capabilities validated |

### 4. Release policy
This document is part of a candidate PR. A green unit-test build is **not** physical QA. The owner-signed APK is private for testing and must not overwrite the current customer download listing or auto-update channel until accepted. Fix failures in a new commit, rerun CI and on-device tests, then decide on a controlled staged rollout and rollback threshold.
