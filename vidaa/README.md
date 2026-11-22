# BLOFY STREAM — VIDAA + Web Preview v0.6

## Playback incident / root-cause fix — 2026-11-22

**Observed:** v0.5 live HLS requests returned HTTP 502. Railway logged FFmpeg process exit code **139 (SIGSEGV)** and `ffmpeg_no_playlist`. The initial worker `ffmpeg-static@5.2.0` even crashed reading a **locally generated, valid H.264/AAC MPEG-TS test file**, both with async Bun.spawn and sync file-input conversion. This isolated the fault to its static binary's MPEG-TS input handling — not the television interface.

**Remediation:** created separate private Railway service `blofy-vidaa-hls-dynamic` using Debian **dynamic-linked FFmpeg 7.1.5** (Dockerfile at `vidaa/hls-dynamic/Dockerfile`). It retains the same bearer authorization, internal secret, resource caps and short-lived HLS sessions. Main app now routes its HLS/compatibility endpoints to `http://blofy-vidaa-hls-dynamic.railway.internal:8080` and displays **v0.6**.

**Validation completed:**
- Success: FFmpeg system binary HLS self-test writes multiple MPEG-TS segments, inspected as H.264 + AAC.
- Success: system FFmpeg remuxed a synthetic H.264/AAC TS source after the old static binary failed the identical test with SIGSEGV.
- Success: system FFmpeg decoded that TS into H.264/AAC HLS using synchronous subprocess.
- Success: Bun asynchronous FFmpeg `stdin: ReadableStream` decoded the synthetic TS and produced H.264/AAC HLS, exit code 0, no signal.
- Success: Railway service deployments online with no current crash reports.
- **Not yet passed:** real authorized channel, movie/episode playback with audible sound on user browser / Toshiba hardware. Do not report as production-ready until these tests pass. The earlier v0.5 real channel HTTP 502s predate the dynamic worker switch.

The original Android customer services and builds remain unchanged. The older static worker is retained temporarily for rollback visibility but is no longer selected by the web app.

---

## New HLS pilot (2026-11-22)

This revision replaces the failed experimental MKV/TS browser pipeline as the default playback path with an **authenticated HLS preview**. The UI now serves same-origin `/api/hls/{kind}/{id}/{extension}/{track}/index.m3u8` and relative `seg-000000.ts` through the existing secure session-cookie gateway. The separate Railway `blofy-vidaa-media-compat-pilot` worker fetches the authorized first-party media with a short-lived Bearer token, transcodes video to **H.264 Baseline 480p** and audio to **AAC-LC stereo**, and writes ephemeral HLS segments. The preview uses native HLS when available, otherwise pinned `hls.js 1.5.20` with Media Source Extensions. It does not expose upstream hosts, Xtream credentials or Bearer tokens to the browser.

The worker limits concurrent conversion jobs to **2**, uses account-scoped HMAC session IDs, has an approximately **9-minute absolute session TTL** plus an idle timeout, and deletes segment files and kills FFmpeg on stop. This is deliberately **not** production scale: memory, temporary storage, CPU, simultaneous viewers, seeking, restarts and long streams still require a durable media-transcoding architecture.

### What is actually verified

- **PASS:** Railway reports both pilot services online and their latest deployments successful.
- **PASS:** private-worker health synthetic FFmpeg/HLS test generated a valid playlist with at least two TS segments, and MPEG-TS PMT inspection confirmed **H.264 video and AAC audio**. This is synthetic media, not a customer's channel.
- **PASS:** HLS.js library returned an HTTP 200 from the public app's same-origin vendor route during a controlled temporary POST smoke test (the temporary POST route has been disabled).
- **NOT VERIFIED:** a complete authenticated real-world BLOFY source HLS transfer through UI → media worker → actual Toshiba/desktop playback, or any actual sound heard by a user.
- **NOT VERIFIED:** playable output on VIDAA U3 firmware P0219 (native HLS availability and decoding) or clients with neither native HLS nor MSE.

**Do not announce that live TV or audio has been fixed for customers until real sample streams pass with both audio and video on target devices.** The source gateway itself rejects protected direct `.m3u8` with 415; the new HLS worker only uses authorized original TS/MKV/MP4 sources and constructs new browser-compatible playlists privately. Do not claim to have enabled the original Xtream protected HLS route.

### Test procedure for owner

1. On desktop, hard refresh the preview URL; log in with a dedicated test code (avoid device-binding an active customer's subscription).
2. Test a movie/episode; confirm both actual sound and picture. The first HLS preparation may take several seconds because transcoding must produce a segment.
3. Test one licensed live channel, the muted preview, unmuted fullscreen, and the return button. Confirm that changing channels stops previous conversion jobs.
4. If playback fails, inspect user-visible status and `BLOFY_VIDAA_PLAYBACK_DIAG` plus media worker's sanitized `VIDAA_HLS_` logs. No subscription keys or account IDs should appear in those logs.
5. Only after those pass, repeat on Toshiba VIDAA U3.

Keep the original `BLOFY STREAM` Android app and its customer production services unchanged.

---


**Experimental** multi-target web app, developed independently from the Android customer build. Current preview: https://blofy-vidaa-webapp-production.up.railway.app/

## Why two playback paths?

Android uses native Media3/other player engines. VIDAA U3 and desktop browsers do not share those codecs and do not run Android APKs.

Existing authorized stream gateway:
- Direct `/api/media/:kind/:id.ext` forwards the account-bound token to `https://blofyplayer.com/api/v1/stream/media/`.
- Protected `.m3u8` currently returns HTTP 415, so it is not a functional backup.
- Movie and episode MKV streams may show video without audio when source soundtrack (often AC-3/E-AC-3, DTS, etc.) is unsupported on the browser.
- MPEGTS.js handles some TS streams in MSE-capable desktop browsers, but does not magically decode every video/audio codec or provide MSE on older VIDAA firmware.

## Experimental v0.4 compatibility pilot

Source: `vidaa/media-compat.ts`, deployed as a **separate Railway Function** `blofy-vidaa-media-compat-pilot` within independent project `BLOFY-VIDAA-PREVIEW`.

- Main app checks the subscribed account's secure HttpOnly session cookie. It sends the authorized Bearer only to a private Railway worker over `*.railway.internal`.
- Worker validates a 64-character private `VIDAA_COMPAT_KEY`, restricts route to integer item IDs and approved kinds/extensions, and fetches only the fixed first-party authorized media endpoint, with redirect disabled.
- FFmpeg reads authenticated response bytes on stdin (not a redirected provider URL) and converts audio to AAC. Video is copied when possible, avoiding unnecessary re-encoding.
- Optional explicit `mode=video` re-encodes video as H.264 to help older device codecs. This is CPU-intensive and intended only for controlled tests.
- Live output is MPEG-TS with AAC audio; browser uses MPEGTS.js if Media Source Extensions exists, otherwise attempts native TS playback.
- VOD output is fragmented MP4 with AAC audio for progressive playback. Automatic AAC conversion is enabled for MKV files in the player, plus buttons for original format, audio compatibility, full A/V compatibility, and audio-track selection.
- Concurrency cap: **2 FFmpeg sessions**. No transcoded streams or customer keys are cached. No URLs with credentials are exposed to the browser.

This **does not prove** the media will play in VIDAA U3; live video and audio must be verified physically on the Toshiba TV. Worker may run into platform CPU quotas, unknown source formats, firmware decoder limitations, or long-running HTTP streaming constraints. Do not enable commercial customer traffic or assume playback success based on a 200 response alone.

## Interface alignment

Based on actual Android sources:
- `app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt`: three-pane live view: preview at left, channels center, categories right.
- `app/src/main/java/tv/blofy/player/ui/catalog/PosterCatalogActivity.kt`: poster grid at left, categories right.
- Same BLOFY activation codes, source account, catalog categories, movie/series details, favorites, and search.
- TV D-pad keyboard focus plus responsive desktop/mobile browser layout.

Web app includes `/app.webmanifest` and an SVG app icon as a future PWA base. This is **not** a public web product launch.

## On-TV testing

1. Open `hisense://debug` on Toshiba 58U5069EE (VIDAA U3 / P0219).
2. App Name: `BLOFY STREAM`. App Url: https://blofy-vidaa-webapp-production.up.railway.app/
3. Resolution: `720`; install and launch; use a dedicated test code.
4. In Settings, run `فحص محرك الصوت` and `اختبار صوت الجهاز`.
5. Test 2 movie and 2 episode samples, listening for actual audio (not just a working video picture). Switch audio tracks and compatibility modes if needed.
6. Test at least 3 authorized live channels: preview on left, full-screen playback, audio + video, network disconnect/reconnect, back button and focus.
7. Confirm poster images load from source URLs and category switching remains responsive.

## Release gate for a future official web launch

Not ready until: audio and live success on target VIDAA and desktop browsers; full parity with Android UX/navigation, player fallback and error reports, EPG, subtitle/audio controls, search and smart recommendations, watched progress and resume, customer session/relogin robustness, poster fallback/resizing, accessible D-pad/keyboard, license and restream rights verification, abuse/cost controls, rate limits, transcoding autoscale beyond 2 sessions, and 1- to 24-hour soak tests.

## Security and operations

- Main service variable `VIDAA_SESSION_KEY` is private, random 64 hex characters; worker/main share **separate** private `VIDAA_COMPAT_KEY` (also 64 hex). Never put either key in Git, web URLs, screenshots or responses.
- Worker has a health endpoint and otherwise requires the internal secret and a valid device-bound Bearer.
- The main app enforces account authentication before media conversion or metadata access.
- Client screenshots/debug logs must never expose stream codes, tokens or original Xtream credentials.
- Do not deploy this branch into Android customer production. All work remains in isolated BLOFY-VIDAA-PREVIEW on Railway.
