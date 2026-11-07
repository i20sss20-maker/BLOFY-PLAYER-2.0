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
