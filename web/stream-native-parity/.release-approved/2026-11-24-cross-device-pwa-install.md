# BLOFY STREAM Web 1.0 — Cross-device Installable PWA

Approved for Web-only production: 2026-11-24 (Asia/Riyadh). Merged PR #883, source squash `b6b3a900a7ec92ef45d02887f4f87296849d48a5`.

## Changes
- iOS Safari standalone web app metadata, immersive black status bar, correct 180px PNG Apple touch icon, and explicit suppression of auto-detecting numeric activation codes as telephone numbers.
- Android/Chrome PWA includes genuine 192×192 and 512×512 PNG icons, in addition to original vector logo; manifest retains same-origin '/' ID, scope, start URL and standalone mode.
- On authenticated Settings page, provide a device-aware, nonintrusive **user-triggered** installation action. iOS instructions require Safari and Open as Web App; Chrome installation calls a real browser-issued beforeinstallprompt only following user click; VIDAA/Toshiba instructions are browser bookmark/shortcut guidance and do NOT suggest APK sideloading or claim native VIDAA store approval. Detect already-installed standalone app.
- Safe-area-aware navigation padding and adequate touch targets on mobile/iPhone, with legacy fallbacks for television browsers.
- Extend static server whitelist and shell-only service-worker cache for the public icons; never cache /api, account sessions, HLS or video. Leave streaming engines, source URLs, subscription/auth flows and FFmpeg allocation untouched.

## Verification
- PR #883 dedicated PWA smoke tests PASSED, checking iOS/Android/VIDAA installation guidance, all PNG dimensions, actual zlib decompression and static route/MIME.
- Official BLOFY STREAM Web 1.0 Chrome+remote UI release workflow PASSED on PR head `9c9312d23c9409e605eccaf06e822957b354be07`.
- Live freeze guard, first-picture, first playable fragment, dual-engine recoveries, VOD handoff, media backpressure and encoder capacity workflows SUCCESS.
- Independent Android CI failed, unrelated to this *web-only* PWA change; do not claim an Android APK build or release.
- No physical iPhone standalone login/playback, Android WebAPK, or Toshiba VIDAA 20-min subscribed media acceptance performed: device/browser media and installation behavior still need real-world acceptance.

## Deployment scope and rollback
- **Only** `blofy-stream-web` (Railway ID `f109c5f9-b81d-460d-81e5-175cc9b3df18`) in project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Do NOT redeploy separate media worker `63d4951c-4cda-4879-97cb-01c6700e02c7`, VOD worker, Android app, activation, customer credentials or Xtream.
- Existing working production Web rollback commit: `5a5de288e7a98ad308d04ee1f3db8abf746b57dc` / Railway deployment `e1edf232-2ba0-4179-98cc-c293d591cc42`.
