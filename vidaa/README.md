# BLOFY STREAM — VIDAA + Web Preview v0.4

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
