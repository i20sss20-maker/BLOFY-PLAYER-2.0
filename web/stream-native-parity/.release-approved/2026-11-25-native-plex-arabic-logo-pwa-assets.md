# BLOFY STREAM Web — official Arabic typeface + logo and iPhone/PWA icon fix

Release approved on 2026-11-25 (Asia/Riyadh).
PR #899 merged as `1c6e43ed5f34f03dfd0a1af11751b8c43110db62`.

## User issue / actual production cause
The prior web theme overrode native Arabic typography with system-ui fallback. The CSS/logo reference did not bundle a font face in the Web service, so native Arabic type was inconsistent across Safari, Chromium and VIDAA. The PWA manifest and static routes linked icon PNG files which were not actually copied into the production Docker image, causing missing Apple home-screen and installed-app icons.

## Approved changes
- Reuse the exact first-party IBM Plex Sans Arabic Regular/SemiBold blobs from BLOFY STREAM Android source and deploy them as local /fonts/*.ttf. Apply consistently to Arabic UI on home, live, movies, series, details, code-only login and player controls.
- Preserve native BLOFY STREAM circular-ring cyan/sky/yellow-play icon identity, polish SVG with accessible title and gradient highlights. Update wordmark/icon scale, stroke and button/label typography.
- Add strict same-origin static font whitelist with correct font/ttf MIME and bounded public caching; preload regular face for stable first paint. No third-party font host/CDN.
- Include all three original existing PNG install icons (180, 192, 512) AND native local fonts in production Docker COPY. App manifest and Apple touch icon then point to real assets.
- Bump network-first public offline shell to v6 and cache public fonts/icons only; no subscription, account or media caching changes.
- No changes to FFmpeg, Xtream, media worker, auth, payments, videos, Android app or desktop release.

## Quality evidence
Official Web 1.0 Chrome QA #45499741493 SUCCESS, including original browser/remote workflow, 320px/390px mobile UI, full film/live navigation, new local-font/PNG asset test, real browser requests returning 200 for both fonts and all PWA logos, and font readiness via document.fonts. Supporting live first frame, VOD handoff, dual engine, video freeze guard, media backpressure and encoder capacity checks SUCCESS at PR head `561706f00c08a938eaa41b770fc196e3d672d6b9`.
Android CI independently failed and is out of scope; no Android binaries changed.
Physical iPhone/Toshiba 20-minute continuous playback and network origin stability are **not** validated by UI font/icon changes.

## Rollout isolation and rollback
Only redeploy Railway BLOFY-VIDAA-PREVIEW `eeff35dc-1754-4f1e-92d7-e28473401453` service `blofy-stream-web` id `f109c5f9-b81d-460d-81e5-175cc9b3df18`.
Keep `blofy-stream-web-media` id `63d4951c-4cda-4879-97cb-01c6700e02c7` unchanged.
Previous successful web rollback deployment `5035e1db-9835-4d16-bc62-e9c3eee940d2` at `46592ad342e604719603b387fd6c4203948f7dd3`.
