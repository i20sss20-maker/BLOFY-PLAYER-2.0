# BLOFY STREAM — VIDAA U3 Debug Edition

This is a separate **experimental** VIDAA web application (not an Android APK) with an independent Railway deployment, to trial on Toshiba 58U5069EE (VIDAA U3, firmware P0219).

## Preview URL

https://blofy-vidaa-webapp-production.up.railway.app/

## VIDAA Debug installation

1. Open the TV browser and go to `hisense://debug`.
2. App Name: `BLOFY STREAM`.
3. App Url: the HTTPS preview URL above.
4. Resolution: `720` (test on this TV) and choose INSTALL.
5. Exit debug, open My Apps, launch BLOFY STREAM.

## Implemented in first preview

- TV-first black/champagne UI based on app/src/main/java/tv/blofy/player/ui/common/BlofyTvDesign.kt
- Right sidebar matching HomeActivity navigation: Home, Live, Movies, Series, Favorites, Search, Settings
- Code-only redemption via the existing `/api/v1/stream/app/redeem` and session verification via `/api/v1/stream/app/session`
- Authenticated Xtream catalog via `/player_api.php`: categories, live, vod, series and episode info
- Playback route through `/api/v1/stream/media/` with server-side Bearer forwarding; the Bearer is stored in a server-encrypted HttpOnly Secure SameSite cookie, not embedded in image or media URLs
- D-pad focus management, favorites (local), manual refresh, diagnostics, subtitles and audio subject to device support

## Limitations / acceptance criteria

**Do not distribute to customers yet.** A live device test has NOT been completed. VIDAA U3 browser media decoder may not play TS/HLS or some formats; memory constraints may impact huge Xtream lists. The browser's storage may be cleared by TV maintenance, losing the installation identity; use a dedicated test code rather than an active customer's subscription, since code redemption can bind a device.

Offline downloads, native Android Media3/VLC engines, full AI search, detailed EPG, resume sync, and verified performance are not part of this first release. User must verify actual playback, artwork, remote/back-key, code redemption, and text encoding on the TV before any customer rollout.

## Security / deployment

- Service project: `BLOFY-VIDAA-PREVIEW`, independent of active production projects
- Railway Function source: `vidaa/index.ts`
- Set `VIDAA_SESSION_KEY` (64 hexadecimal chars) as a private service variable
- Never store customer Xtream credentials or Bearer in Git
- Review code before merging. Preview code lives on its own branch; original Android source and production deployments are unchanged.
