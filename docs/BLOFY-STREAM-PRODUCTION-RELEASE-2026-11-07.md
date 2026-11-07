# BLOFY STREAM 2.0 — production integration (2026-11-07)

## Live production
Project: Railway `BLOFY-Update-Distribution` / environment `production`.
- `blofy-activation-portal`: pinned to `dfdb71ae66333e48bf326d7b0a9189b1964fa9ed` on `blofy-stream-stable-improvements-20261107`.
- `blofy-restream-engine`: MediaMTX `bluenviron/mediamtx:1.19.2-ffmpeg`, HLS :8888 on Railway **private network only**, no public domain. Publisher RTSP bound to loopback. No licensed upstream channel is configured.
- `blofy-update-distribution` and `Postgres`: unchanged.
- Encrypted environment secret names on portal remain untouched; only `BLOFY_RESTREAM_ENGINE_URL=http://blofy-restream-engine.railway.internal:8888` was added.

## Code
- Pinned old restored production base `872d1eca1b66d18d7c44ad3a43a90727592aadbb` plus isolated safe series ID translation, no live/movie playback code modifications.
- New `/api/v1/admin/restream-engine/health` endpoint, bearer or authenticated admin session only. A 404 from MediaMTX root is normal and means listener responds; NOT proof of playable media.
- BLOFY STREAM `/sources-admin` page displays official HLS engine connection status separately from source/video playback health.

## Verified after rollout
- All four Railway production services online with 0 warnings/criticals.
- Latest portal deployment `3facd704-4aab-4a42-a741-700657750f1e` succeeded; runtime confirms activation service started on port 3000 and DB ready.
- Private network smoke test: `http://blofy-restream-engine.railway.internal:8888/` reachable, HTTP 404 (expected for no published path).
- Public site `https://blofyplayer.com/health` returned HTTP 200.
- Unauthenticated admin endpoint returned HTTP 401; `https://blofyplayer.com/sources-admin` returned HTTP 200.
- Railway last-hour HTTP sample at verification: 168 requests, zero 5xx.
- Transient smoke-test Railway Function was deleted after verification.

## Not yet verified
- No real licensed Xtream channel/movie/episode has been started using MediaMTX on production.
- The new restream engine is not yet serving customers; all previous playback routes are preserved to avoid unrelated regressions.
- Source `annkel.com` reset/denial between Railway and upstream remains a separate unsolved transport issue.
- Series ID unit tests passed in the local isolated resolver only; no genuine end-to-end episode playback assertion was obtained.

## Rollback
If the new portal release causes regressions, redeploy the previous successfully running Railway build:
- project `60e7758a-6b19-4445-b21c-9cb928ccef04`
- service `73f961be-ef0f-444a-844e-a8a5df5ef66c`
- environment `7a3e9208-69a8-45f9-b5e7-427921de73a9`
- previous deployment `01addffe-50c7-438b-965d-43f43a83893c`
- commit `872d1eca1b66d18d7c44ad3a43a90727592aadbb`
This leaves DB/subscribers, independent media engine and domain settings unchanged. Do NOT redeploy newest `main`, which contains experimental modifications absent from the recovered stable build. Use a pinned commit or explicit, reviewed release.

## BLOFY STREAM PRO premium admin rollout (2026-11-07)
- Official Railway activation service pinned to commit `946f4a38efd1d7283328d34c11dff9aca36dd5a2`. Deployment ID `971c070d-2769-4d88-95e8-a5e61a3dcbb7`, status SUCCESS and /health check succeeded.
- New `stream-premium.css` and `stream-premium.js` served at versioned paths via `sources-admin-hook.mjs`. Live route has cinematic visual identity, RTL/mobile responsiveness, and operations home dashboard.
- Added commands: Ctrl/Cmd+K search palette, deep-links to sources/accounts/diagnostics/library, source-specific name/ID search, errors-only filter, exported credential-free CSV summary, compact density preference, source issue insights and accurate indexed catalog donut.
- Added read-only Xtream subscriber totals (active, next 7-day expiry, expired) computed from the existing protected account API, with no credential data sent through snapshot events.
- Added 401/404/502 guidance with distinctions between upstream and BLOFY auth. Did **not** change production customer media routes.
- Verified official public HTML, premium CSS, premium JS, original admin JS, account JS, /health: 200 with expected content; JS syntax checks passed. Unauthenticated protected engine admin returned 401.
- Last-hour Railway portal HTTP sample at verification: 355 requests, 0 HTTP 5xx; all four services online. Temporary one-time release verifier service deleted.
- Pre-release regression test file `services/activation/test/stream-console-ui.test.mjs` and workflow updated; a fully automated real-browser operator session was not executed.
- Rollback to previous successful admin UI deployment `ac907c1d-af90-4ddf-af7a-5d19dff60e66` (commit `f6fd2a8c03c01904aaa074a1a14ce7112629f821`) if UI regression occurs.
- MediaMTX is connected but currently **not** adopted for real Xtream customer playback. Original provider 502/series transport failures remain separate operational work.
