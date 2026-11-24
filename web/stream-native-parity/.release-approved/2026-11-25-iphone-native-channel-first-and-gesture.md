# BLOFY STREAM Web — iPhone WebKit HLS and one-tap native channel release

Approval: 2026-11-25 (Asia/Riyadh), PR #893 merged at `15558e0bc68e8463625de1565dcad59974b987ef`; incorporates production live-session cleanup and worker capacity reporting from #894.

## Observed behavior
Railway HTTP logs include iPhone Safari media segment/manifest 200 responses, intermittent 429 on temporary live/transcode capacity, and some app-returned 5xx. These are source/client symptoms: HTTP transport success alone does not guarantee continuous decoded picture. Unrequested mobile live previews consume precious worker slots, and Apple's WebKit sometimes requires a direct tap to start audio/video.

## Scoped fixes approved
- Use native Apple HLS for all browsers on iPhone/iPad (Safari/Chrome/Firefox/Edge, and desktop-user-agent iPadOS) when supported. Never force Hls.js/MSE because of a previous fallback from another browser.
- Offer an accessible tap-to-start overlay only on **current** iOS playback if an actual NotAllowedError denies audio autoplay. The tap calls only `video.play()`; no extra source/session, credentials or video DOM replacement. Keep explicit user pause and channel switching unchanged. Show resume failure instead of silently swallowing it.
- On iPhone, selecting a channel opens its full player in **one tap**, as in a native IPTV app. Initial channel selection does not automatically start a muted transcoder preview; explicit Preview still works via its button. TV/desktop retain their previous auto-preview behavior. This reduces needless active worker slots and rapid churn but does not guarantee availability if every encoder is busy.
- Preserve the Android-inspired UI, categories, favorites, EPG, player source modes, resume, local playback diagnostics, and iPhone safe-area/fullscreen improvements from earlier release.
- Align read-only web encoder-capacity sanitizer test with the safe four-slot *deployed* media pilot; no change to worker code or its currently pinned live deployment.

## Quality gates
- Official Web 1.0 UA/Chrome UI QA #45494032736: SUCCESS. Mobile layout, D-pad/desktop, web auth boundary, autoplay gesture regression, and other Web QA passed.
- Encoder capacity evidence #45494032903 SUCCESS; HLS first-playable #45494032668 SUCCESS; fast first picture #45494032800 SUCCESS; decoder freeze #45494032763 SUCCESS; dual engine #45494032771 SUCCESS; VOD handoff #45494032931 SUCCESS; media backpressure #45494032901 SUCCESS.
- Independent Android CI #45494032801 FAILURE, Android code untouched, no Android build released.
- Real *physical* iPhone 20-minute continuous playback with an authorized live source is **not** yet verified; no claim that upstream 429s have all disappeared.

## Deployment guard and rollback
- Only redeploy existing Railway `blofy-stream-web` service `f109c5f9-b81d-460d-81e5-175cc9b3df18` in BLOFY-VIDAA-PREVIEW `eeff35dc-1754-4f1e-92d7-e28473401453`.
- Keep separately pinned `blofy-stream-web-media`, Android, Xtream, activation, payment and PostgreSQL untouched.
- Known previous successful Web deployment: `97904eb7-49f5-475b-88de-15be34f2f8f0` (commit `9d635d611f53b8eac7ecf01f46fd6755482d3326`). Roll back if new Web healthcheck fails or subscriber errors increase.
