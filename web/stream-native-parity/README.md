# BLOFY STREAM Web — Native-Parity Implementation

This is a **separate web port** of the actual **BLOFY STREAM** Android flavor, not a reskin of the earlier VIDAA gold-themed experiment.

## Source of truth

- Branch audited: `release/stream-56-0-4-final-20261121`.
- Android build flavor: `streamCodeOnly` with `CODE_ONLY_LOGIN=true`, `applicationIdSuffix=".stream"`.
- Visual tokens: `app/src/main/java/tv/blofy/player/ui/common/CinemaStyle.kt` and `BlofyTvDesign.kt`.
- Home/sidebar: `app/src/main/java/tv/blofy/player/ui/home/HomeActivity.kt` and `HomeLayoutSpec.kt`.
- Live 3-pane browser: `app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt`.
- Movie/series poster catalog: `app/src/main/java/tv/blofy/player/ui/catalog/PosterCatalogActivity.kt`.
- Details: `app/src/main/java/tv/blofy/player/ui/details/MovieDetailsActivity.kt`, `SeriesDetailsActivity.kt`.
- Seasons: `app/src/main/java/tv/blofy/player/ui/series/EpisodesActivity.kt`.
- Playback & resume: `app/src/main/java/tv/blofy/player/ui/player/PlayerActivity.kt`, `ResumeCheckpoint.kt`.
- App icon: `app/src/main/res/drawable/stream_app_icon.xml`.

## Exact STREAM visual tokens

| Native field | Web port |
| --- | --- |
| STREAM background | `#06161D` |
| STREAM surface | `#10303B` |
| STREAM primary accent | `#46E4D0` |
| STREAM text | `#F2FCFB` |
| Muted text | `#AACBD0` |
| TV home navigation rail | 150px |
| TV home hero height | 274px |
| Poster aspect ratio | 2:3 |
| Large poster grid | 6 columns (adaptive) |
| Card radius | 16px |
| Panel radius | 22px |
| Focus-in / focus-out | 95ms / 75ms |
| Section transition | 135ms |
| STREAM icon | Vector geometry carried from Android asset |

The preceding VIDAA gold/violet preview did **not** use the STREAM Android visual identity; this port corrects that mismatch.

## Implemented baseline

Home hero + horizontally scrolling shelves; sidebar/DPAD; live categories on right, channels middle, preview left; sorted movie/series posters; movie/series details; seasons and episodes; server-backed search; favorites; code-only activation; first-party authenticated catalog/media proxy; original icon; initial playback and checkpoint controls. These features reuse the existing BLOFY server, while the web service and branch are isolated from Android production.

**VOD vs. live difference:** web VOD is intentionally not served as a live-only temporary timeline. Playable MP4 uses original media endpoint and HTTP Range/HTML5 seeking. Unsupported MKV/AVI attempt the isolated VOD HLS worker: audio AAC, H.264 video, an account-bound session that starts at an explicit absolute time, with new segment generation on seeking and persistence of actual elapsed position. The worker fetches only authorized first-party content via an authenticated localhost Range bridge, and has limited conversion capacity.

**This is an engineering preview, not a claim of completed parity.** The APK is native Android with Media3/VLC and cannot run unchanged in a web browser. Visual and interaction behavior can be ported, but media, offline downloads, AI search and device key handling need target-specific implementations.

## Known unverified and incomplete areas

- Real-world MKV seeking and resumption require upstream Range support and have not passed an actual subscriber playback test. Seeking past the buffered range may fail for sources that ignore Range; do not claim this is fixed based on synthetic test files.
- Real live TV and audio playback in VIDAA U3 must be verified on the Toshiba (a browser that lacks HLS/MSE still cannot play all sources).
- Resume/favorites currently save **locally in the browser**, not synced to the native Android account.
- AI chat is now wired through the **existing first-party native STREAM AI interpretation gateway**, with search-link suggestions. Subscriber-authorized AI behavior is not yet verified end to end. Offline downloads, subtitle tracks, EPG/catch-up, profiles and parental restrictions remain unported; audio selection works only where the browser supplies real additional tracks.
- Provider metadata image fallback may be incomplete on some series, and catalog first loads may depend on upstream response.
- The web transcoding pilot is limited to **two concurrent FFmpeg jobs**. It must not be offered publicly until scale tests, rate limiting, licensing checks, and safe caching are complete.


## Engineering improvements — 23 November 2026

- **True full-film HLS mode:** a declared-duration VOD playlist with `#EXT-X-ENDLIST` and on-demand absolute-time 4-second chunks. The previous short, growing event playlist is retained **only** as an explicit fallback when duration is unknown; it must never be represented as the entire film.
- **Seeking and recovery:** backwards/forwards jumps, 5-minute skip, checkpoint resume, per-episode duration priority, next-episode navigation, direct-MP4 failure fallback and manual retry at the last playback position.
- **Resilience:** bounded chunk source connections, transparent buffering status, reconnect attempts, source-range validation, sequential chunk protection, bounded temporary segment retention, and no forced restart at zero for recoverable errors.
- **Native-like browsing:** responsive sidebar/bottom navigation, D-pad focus, preserved grid and category scroll, fast incremental loading, real search filters and remembered recent searches. Arabic normalization handles common writing variants.
- **Account convenience:** movie and episode continue-watching cards and favorite poster metadata survive page refresh **locally in this browser**. The manual content refresh now actually reads the server, with step progress; optional catalog version polling triggers quiet refresh when supported.
- **AI assistant:** separate chat UI proxies to the same authenticated AI gateway as STREAM Android; no gateway/model keys in the web client. Suggested titles link to authenticated **catalog search**, not to fabricated playback links.
- **Playback utilities:** full-screen mode, playback speed, and switching real additional browser/HLS audio tracks when present. Unavailable tracks are not falsely claimed.

### Verification already performed

- Railway web app and independent VOD worker deployed with health checks; the Android production build was not modified.
- The worker's startup synthetic VOD self-test produced H.264/AAC MPEG-TS segments from two **different absolute positions**, with an 8-second timestamp offset and a complete end-listed playlist.
- Railway runtime has reported successful `BLOFY_FULL_VOD_CHUNK_OK` events for authenticated real-content requests, and HTTP 200 replies on the new `/api/vodfull/` path. These observations **do not** prove a full feature-length title can be watched and seeked without failures.
- JavaScript parsing passed for the web UI and worker. Browser and platform checks on actual TVs/iPhones, subscribed AI calls, 20+ minute playback, file format variations, and multiple concurrent subscribers are still release gates.

### Still not at full Android parity

The web pilot cannot reuse Android's Media3/VLC engines unchanged. Full-resolution 4K playback, native downloads/offline persistence, subtitles and multiple audio streams where the upstream source does not expose them, cloud synchronization with Android, EPG, profiles and strong large-scale concurrency remain outstanding. The VOD pilot is restricted to two concurrent FFmpeg processes and is **not approved for public mass rollout**. Actual title-level seeking requires the authorized source to support random byte access.


## Deployment & safety

- Separate Railway project: `BLOFY-VIDAA-PREVIEW`; new service: `blofy-stream-native-web-parity`.
- Preview: `https://blofy-stream-native-web-parity-production.up.railway.app/`.
- Separate VOD service: `blofy-stream-web-vod-seek-pilot` (private network; no public domain).
- Main server: `web/stream-native-parity/server.ts`; frontend: `app.js`, `styles.css`, `index.html`; VOD worker: `media-worker.ts`.
- Secret material is Railway-only. Never commit tokens, passwords, access codes, or private media source URLs.
- **Do not merge into Android release or publish as a customer web product until release gates pass.** Original STREAM Android production APK and prior VIDAA test site are unchanged.

## Verification log

- Railway new web service: deployment and healthcheck succeeded.
- Live code-only activation server, static assets, JS compilation, STREAM CSS source tokens and secret configuration passed a non-customer synthetic self-test.
- VOD worker startup/health can run without customer credentials; full end-to-end Range seek with actual subscribed content and audio/video requires further validation.
- UI was ported by reading source code; pixel-by-pixel comparison against a running physical Android TV is still required before calling it visually identical.
