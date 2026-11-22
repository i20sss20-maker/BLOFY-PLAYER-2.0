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
- AI chat, offline downloads, subtitles/audio track mapping, EPG/catch-up, profiles and parental restrictions need real integration.
- Provider metadata image fallback may be incomplete on some series, and catalog first loads may depend on upstream response.
- The web transcoding pilot is limited to **two concurrent FFmpeg jobs**. It must not be offered publicly until scale tests, rate limiting, licensing checks, and safe caching are complete.

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
