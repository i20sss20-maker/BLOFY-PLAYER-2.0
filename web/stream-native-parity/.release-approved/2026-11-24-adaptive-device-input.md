# BLOFY STREAM Web — Adaptive device interaction (web only)

Approval date: 2026-11-24 Asia/Riyadh. Source PR #885 merged as `f4f5fa5b0200d5efbdbebc6e626106524ddf93b5`.

## Changes
- Detect Toshiba/VIDAA, Android TV/TV browsers, iPhone, iPadOS with desktop Safari user agent, Android touch, and desktop environment locally; set data-blofy-device on the root HTML element.
- Switch local control modality between remote/keyboard, touch and mouse without reload, playback restart, API request, new FFmpeg job, subscription change, or persisted account data.
- Preserve remote focus when TV Enter key emits a synthetic mouse pointer event. Distinct accessible D-pad focus and large touch targets, with existing iPhone safe areas retained.
- Display locally detected device and input in Settings beside existing PWA install guide; iPadOS masquerading as Mac gets Safari install instructions.
- No media-worker, HLS, MPEG-TS, VOD, account, activation or Xtream changes.

## Verification
- Official BLOFY STREAM Web 1.0 browser + TV remote QA workflow SUCCESS for head `98a1639c66efff69e651a83ad416161b4fa68ce2`.
- New dedicated Node regression tests for remote, touch, desktop, iPadOS, focus, settings and privacy SUCCESS; existing iOS/Android PWA tests SUCCESS.
- Live first picture, video freeze guard, first playable segment, dual-engine recovery, VOD transcode handoff, backpressure and encoder capacity CI SUCCESS.
- Separate Android CI FAILURE on Android-specific work (untouched). Do not deploy native apps.
- No claim of real 20-minute subscribed Toshiba/VIDAA playback or manual iPhone standalone PWA verification.

## Release and rollback
- Railway `BLOFY-VIDAA-PREVIEW` `eeff35dc-1754-4f1e-92d7-e28473401453`, production `a9a26993-0cec-410d-83dc-2f14a2e47045`: deploy **only** `blofy-stream-web` `f109c5f9-b81d-460d-81e5-175cc9b3df18`.
- Leave media worker `63d4951c-4cda-4879-97cb-01c6700e02c7` and VOD worker running untouched; do not modify Android, subscriptions, Xtream, Railway worker limits, source URLs, payments.
- Previous successful web commit `44c4ca7980332f4865fe5bc2c3bb2303eca58b38` on deployment `58cc76c7-03df-4f56-8fdf-57abc7cffcfc` is the immediate web-only rollback target.
