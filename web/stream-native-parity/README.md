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
- AI chat is now wired through the **existing first-party native STREAM AI interpretation gateway**, with search-link suggestions. Subscriber-authorized AI behavior is not yet verified end to end. Offline downloads, EPG catch-up, cloud profiles and parental restrictions remain unported. **Short EPG listings** (when supplied by Xtream) and selection of browser/HLS-exposed subtitle tracks have been added, but provider availability and TV compatibility are not established. Audio selection works only where the browser exposes real additional tracks.
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

The web pilot cannot reuse Android's Media3/VLC engines unchanged. Full-resolution 4K playback, native downloads/offline persistence, automatic subtitles or alternate audio tracks not exposed by the source, cloud synchronization with Android, complete EPG catch-up, user profiles and large-scale concurrency remain outstanding. The VOD pilot is restricted to two concurrent FFmpeg processes and is **not approved for public mass rollout**. Actual title-level seeking requires the authorized source to support random byte access.


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

### Concurrent VOD sessions — 23 November 2026

Every opened film or episode now has a **new, random 128-bit client playback ID** (SID). The SID is part of the manifest request, every HLS media segment URL, and the stop URL. The internal VOD worker includes the SID in its HMAC-derived session key, in addition to the bearer and title. This means that two independent tabs/devices using the same authorized subscription cannot seek, restart, or terminate each other's active VOD session. Requests without SID remain accepted for previous preview clients; malformed SID is rejected. Authentication remains mandatory and the SID is not a substitute for account authorization.

**Verification:** syntax checks for client, API and worker; unit manifest checks for both legacy and SID-aware media URLs; deployment SUCCESS of web and worker with worker's synthetic seek health check passing. **Not yet proved:** simultaneous playback on two subscribed physical devices for a full movie or shared-network congestion under load. The existing MAX_JOBS capacity (2) still limits parallel transcodes. Do not roll out to public customers without live-source and load tests.

## VOD reliability and release gate — 23 November 2026

**Current architecture:** Direct MP4 with real seekable byte ranges first; for sources not genuinely seekable in the browser, close the direct connection and use the two-slot private H.264/AAC VOD worker. When reliable duration is known, use a complete end-listed 4-second HLS timeline; otherwise clearly label the short streaming EVENT fallback as an **unverified duration**. No physical TV or commercial subscriber content is included in the synthetic worker test.

**Race fixes:** Metadata callbacks and their 4.2-second timeouts carry a playback generation so that an old response cannot restart a previously requested position. D-pad button repeats are debounced to one network seek. Resume progress cannot overwrite a new pending seek with an old MP4 frame, and a last-minute seek is not treated as completed viewing. The original MP4 connection is explicitly closed before opening its HLS fallback, important for providers with connection limits.

**Source failure protections:** The localhost media bridge limits the initial Xtream HTTP header wait to 17 seconds, without imposing a fixed timeout on the video body. The worker serializes adjacent 24-second conversions, bounds FFmpeg at 75 seconds, and temporarily backs off failed requests for absent segments or overstated source duration; deterministic missing positions produce HTTP 422 rather than restarting FFmpeg indefinitely. The browser distinguishes HTTP 416/422/429 and failed authentication, with Arabic status messages. A slow source can still fail and **real random-access byte support is a hard requirement for accurate seeking**.

**Synthetic verification:** The VOD worker now verifies 8 seconds and **24 seconds across the chunk boundary** in a locally generated 32-second media file, and checks H.264/AAC in generated segments. It reports `verified_vod_seek_across_chunks`. This does **not** establish title-level or full-length subscriber playback, real-device buffering performance, subtitle availability or multi-user capacity.

**Required end-to-end checks before any production release:**

1. On an authorized preview account, play a full movie for at least 20 continuous minutes. Note first frame delay, unexpected stops and total buffering.
2. Seek from 00:00 to 10:00, back to 05:00, then forward to 60:00 on a movie longer than 60 minutes. Verify **actual video frames and audio**, not merely an updated time label.
3. Repeat on a television using the directional pad, including 12 rapid right-arrow presses (must emit one combined seek after the last press), and on a touch browser.
4. Close while a seek is buffering, reopen the title, and verify checkpoint restoration. Restart from zero, then test the last minute without incorrectly marking the whole title completed.
5. Play an episode and move to the next episode; repeat with and without complete Xtream duration metadata, and with a source that rejects HTTP byte-range requests.
6. With only authorized test subscriptions and media, verify two simultaneous viewers and incremental load beyond two worker jobs; interpret HTTP 429 capacity separately from source errors.
7. Inspect **Settings > Last actual playback test** for startup time, buffer count/duration, and seek requests/completions/timeouts. The metrics are local to the authenticated web profile, without storing the subscriber token, provider URL or title identifier.

**Release status: NOT production-ready.** Deploy SUCCESS and synthetic checks establish isolated technical function, not compatibility with every Xtream supplier or the real Android application's playback engines. Do not change customer Android builds or shared BLOFY production services to close these preview-only gaps.


### Boundaries, prefetch and in-player status

The VOD worker now initiates a **single adjacent 24-second chunk in advance** once Hls.js has requested one of the previous group's final two segments and the previous FFmpeg process has finished. It never intentionally opens two simultaneous source connections for the same playback session. The prefetch respects the global two-job capacity, aborts when seeking to another position, and does not run past the movie's duration. This is bounded, on-demand playback buffering, not an offline download.

The synthetic startup media check includes the last four-second segment before a 24-second boundary and the first segment after it; Railway reported `adjacentGapSeconds: 4` and `verified_vod_seek_across_chunks`, with MPEG-TS video and audio tracks present. This establishes synthetic timestamp continuity but **not** real Xtream playback stability.

The player also has an optional **📊 حالة التشغيل** button (hidden panel by default) which shows first frame delay, accumulated buffering, seek outcomes, playback engine and media errors. The panel updates only while open and is cleared when leaving the player. It does not expose subscriber tokens or upstream media URLs.

**Mandatory before customer rollout:** Verify a full movie and episode against a subscribed authorized Xtream source, including forward/backward seeks, actual decoded frames and audio, 20 minutes of continuous playback, restart/resume and two simultaneous viewers. The preview remains separate from the Android customers.

### VOD end detection and absolute-time jump control

The web player now requires observed, plausible **end-of-title playback time** before marking a VOD complete. Native TV decoders sometimes emit `ended` at a short ~24-second chunk boundary despite a two-hour `#EXT-X-ENDLIST` manifest, and unknown-duration EVENT streams may end early. These cases trigger bounded recovery rather than a false 100%-watched checkpoint. Seek-in-progress can never establish completion on its own. Ordinary progress saving is suppressed while an unresolved seek is waiting; pause/exit retains its target for later resumption instead of reporting buffered timestamps as played frames.

For a source that does not expose full runtime metadata, TV and touch users can select **↪ دقيقة محددة**, enter a minute from 0 to 359, and press **انتقال**. This performs a real player seek/reopen request at the chosen absolute time (it is not merely a new label), with input validation, D-pad focus handling and an explicit warning that the source must support random byte seeking. A manual minute jump is not a guarantee that the upstream server supports it.

The unit scenarios cover a 24-second early end on a 120-minute movie; source EOF with unknown duration; plausible completion near the true end; unfinished seeking; minute 60 -> absolute 3600s; invalid input; and a deliberate return to minute 0. These are simulated logic checks, not end-to-end testing with customer video or physical TV hardware.

**Recent Railway traffic observation:** Proxy request metrics for the previous day included real authenticated VOD and live transport requests, not just synthetic FFmpeg health tests. HTTP responses for initial full VOD segments were successful, while prior legacy VOD and live manifests included transient 502/503 responses. The presence of successful segment requests does not prove the browser decoded a full film or that distant random seeks work for every Xtream source.


## جودة الصورة وتوافق أجهزة VIDAA (نسخة الويب التجريبية)

- **البث المباشر H.264 / MPEG-TS:** عند تعرف المحرك على ترميز H.264 داخل المصدر ينقل إطارات الفيديو الأصلية إلى HLS دون إعادة ترميزها؛ ويحوّل الصوت إلى AAC لتوافق المتصفحات. لا يمكن رفع جودة مصدر SD ضعيف بهذه الطريقة.
- **اختيار طريقة تشغيل البث من التلفزيون:** زر الجودة داخل المشغل يفتح خيار «أصلي» (مع الاحتفاظ بدقة المصدر المتوافق) أو «متوافق» (تحويل H.264 بحد HD لتجاوز رفض بعض أجهزة VIDAA). إذا رفض المتصفح فك الترميز الأصلي، يحاول المشغل الانتقال للنسخة المتوافقة تلقائيًا بعد التأكد من فشل المحاولات الأصلية. الجلستان منفصلتان بمفاتيح ومسارات HLS مصادق عليها، ويُنتظر إنهاء السابقة قبل بدء الجديدة؛ ولا تُخلط المقاطع أو اتصالات المشاهدين.
- **إغلاق مصادر البث:** عند الخروج أو تغيير القناة يتم إلغاء طلب المصدر الأصلي حتى بعد استلام رؤوس استجابة الشبكة، وليس مجرد إغلاق FFmpeg، لتقليل الاتصالات المعلقة على المزود.
- **بقية البث المباشر:** يظل مسار H.264 التوافقي بحد افتراضي **720p** للحفاظ على استقرار الأجهزة القديمة. يُرفع اختباريًا عبر `VIDAA_LIVE_VIDEO_PROFILE=1080` بعد اختبار المصدر والتلفزيون والموارد.
- **الأفلام والمسلسلات التي تحتاج إلى التحويل:** الحد التجريبي الافتراضي حاليًا **1080p** بجودة CRF 18، بحد معدل 8.5 Mbps، وإعداد veryfast / film؛ يستخدم المحرك حجم الصورة الأصلي إذا كان أصغر. يمكن التراجع إلى 720p عبر `VIDAA_VOD_VIDEO_PROFILE=720` دون تغيير ملفات المصدر. تشغيل MP4 المباشر المتوافق لا يمر بإعادة ترميز.
- **تشخيص الجودة:** يظهر في المشغل قياس دقة الفيديو التي فكّها المتصفح، وهل مسار تشغيل البث مباشر أم أُعيد ضغطه، وفي معاينة القنوات تظهر الأبعاد الحقيقية كذلك. أسماء القنوات مثل 4K و8K وHD ليست دليلًا على الدقة الفعلية.
- **قيود مهمة:** لا يضمن تحويل 1080p تحقيق 1080p حقيقي إذا كان المصدر أقل جودة. بعض ترميزات HEVC وملفات MKV لا تزال تحتاج تحويلًا وقد تسبب عبئًا على معالج الخادم. الحد الحالي عمليتا FFmpeg متزامنتان فقط. يجب قياس زمن بداية الصورة، وتقطيع البث، وسقوط الإطارات، وقدرة الخادم على مصدر مصرح به وشاشة Toshiba/VIDAA فعلية قبل اعتماد عمومي.

## 4K / UHD experimental quality route — 23 November 2026

**Preview-only; no customer Android rollout.** The live HLS origin path retains original H.264 frames with FFmpeg `-c:v copy` when an authorized MPEG-TS source contains H.264. This means 1080p, native 2160p or higher are **not deliberately reduced** by our worker; actual playback is still bounded by the upstream source, client codec, network bandwidth and Toshiba VIDAA decoder capabilities. H.265/HEVC or unsupported formats currently fall back to H.264; do not claim general 8K/HEVC support.

The video-quality dialog offers (1) source-original, (2) compatible H.264 up to 1080p without upscaling, and (3) a **manual 4K trial** only when verified upstream resolution is at least 2160p. The UHD trial uses authenticated `/api/hls/.../ultra/index.m3u8` and an isolated worker session HMAC namespace; it uses x264 at maximum 3840×2160, 20 Mbps rate cap, no fake enlargement, and at most one UHD encode (two total worker jobs). Never automatically start expensive UHD transcoding for compatibility: normal fallback stays at 1080p.

The player's live "حالة التشغيل" dashboard shows source pixel dimensions separately from decoded pixels, stream-copy vs compatibility vs UHD conversion mode, drops, stalls, elapsed runtime and an **estimate** of HLS network download capacity (not video source bitrate). A native 8K label requires decoded pixels, not a channel name. A browser or TV that cannot decode the profile falls back to compatible playback, potentially lowering resolution. It is safer to show an honest 1080p picture than force a stalling software 4K encoder.

Synthetic tests inspect the 2160p filter/bitrate and create an H.264 HLS transport fixture whose actual decoded resolution must remain 3840×2160. This does not confirm that any paid channel is genuinely UHD, that 4K runs smoothly on Toshiba/VIDAA, or that the customer's pitch problem after 10+ minutes is fixed. **Release gates:** physical Toshiba VIDAA playback of a permitted source >10 minutes, frame-drop and actual resolution comparison between modes, 20-minute A/V sync check, source failover and up to two concurrent viewers without interruptions. Keep PR draft and all customer production untouched.
