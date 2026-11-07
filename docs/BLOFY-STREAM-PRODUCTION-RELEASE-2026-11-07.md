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


## BLOFY STREAM PRO operations hardening (2026-11-07)
- Official Railway activation portal production deploy: `9e27de05-22c8-45b0-93df-3d6c105dd4c1`, SUCCESS, pinned commit `db4410ebfdf389e8225e411c1c513ddfe38f04ef`.
- Implemented richer subscriber metrics: active, expiring within seven days, expired, and disabled. Admin receives explicit unavailable state if account API fails instead of silently retaining stale counts.
- Fixed `expiresAt` parsing across epoch milliseconds, epoch seconds and ISO strings; existing accounts with unlimited access cannot accidentally be assigned a 30-day expiration by clicking renew.
- Added a read-only opt-in 90-second refresh, paused while browser tab is not visible; manual refresh also updates source and subscription readouts. No provider sync, subscriber mutations, or playback tests are triggered.
- Added contextual issues panel that links to real failed sources and expiring subscriber filters.
- Added `stream-operations-regression.test.mjs` to CI list and exercised JavaScript syntax and date normalization locally in V8. Do not assume GitHub Actions passed unless a workflow conclusion is independently verified (legacy Vercel check is unrelated to Railway and may be red).
- From Railway one-shot verification: public /health, /sources-admin, premium JS/CSS and admin JS each returned HTTP 200, with expected current release markers and `Cache-Control: no-store`. The verification function was deleted.
- No change to live customer stream routes or upstream authorization. Provider-side Xtream connection resets and occasional 401/404/502 remain separate and require feed-level investigation; passing HLS connectivity does not prove playable third-party media.
- Prior validated production commit for immediate UI rollback: `946f4a38efd1d7283328d34c11dff9aca36dd5a2` (Railway deploy `971c070d-2769-4d88-95e8-a5e61a3dcbb7`, now removed from active deployments; redeploy pinned commit if required). Full original stable rollback: `872d1eca1b66d18d7c44ad3a43a90727592aadbb`.


## Xtream network diagnostic hardening (2026-11-07)
- Official Railway activation portal deployed commit e0014ebc6d257d79acb13d69b7f9b3bff4caf782, deployment 3ca711a2-d74e-41c3-9762-559c6590b0c6, status SUCCESS. /health passed Railway deployment healthcheck and the database initialized.
- Added xtream-transport-errors.mjs with allowlisted diagnostic codes for source DNS failure, refused/reset connections, network timeouts and untrusted TLS certificates. Provider hostname, usernames, passwords, URLs and error bodies never enter these diagnostic events.
- Admin metadata fetch now categorizes connection failures, cancels HTTP redirect bodies, and keeps explicit 401/403/404/456 provider rejections separate. Media gateway improves operator diagnostics only, preserving customer playback paths, response status and retry budgets.
- PRO dashboard source alerts receive allowlisted error codes only, never raw last-error payloads.
- Added services/activation/test/xtream-transport-errors.test.mjs and wired it to branch CI. Seven focused tests passed through independent JavaScript evaluation, not a complete Node/GitHub Actions or end-to-end playback test.
- Railway backend stayed online with zero 5xx in the observed 415-request one-hour sample; all four persistent services healthy. The temporary public-asset verifier did not produce conclusive request logs and was deleted. Public asset verification is not claimed for this increment.
- Still pending: verify a permitted real Xtream feed from production for live, movie and series playback. An upstream network restriction or provider refusal cannot be fixed merely by classifying errors. Do not deploy source workarounds or switch customer playback to MediaMTX until end-to-end testing succeeds.
- Rollback for this increment: previous commit db4410ebfdf389e8225e411c1c513ddfe38f04ef (prior Railway deployment 9e27de05-22c8-45b0-93df-3d6c105dd4c1; if removed, redeploy pinned commit). Full original stable: 872d1eca1b66d18d7c44ad3a43a90727592aadbb.


## Bounded Xtream account reconnection and source-probe accuracy
- Modified only safe account metadata connectivity: failed non-2xx API bodies now cancel cleanly before returning `xtream_http_<status>`, reducing blocked upstream connections.
- Source account metadata uses `xtream-api-resilience.mjs`: at most **two** GET attempts total, separated by 450 ms, only on allowlisted transient network failures or HTTP 502/503/504. No retries on HTTP 401, 403, 404, 429, 456, invalid certificates or forbidden private endpoints. Stream playback, episode content and catalog bulk downloads are never retried by this helper.
- One-click source media samples (live/movie/episode) now preserve categorized transport errors instead of collapsing them into a generic unavailable string.
- The batch media probe's `issues` filter now selects only sources with recorded errors, and source search includes the source ID.
- The existing user account and catalog DB schemas, public playback URLs, provider permission checks and media retry count were **not changed**.
- Regression coverage: `services/activation/test/xtream-api-resilience.test.mjs` plus existing `xtream-transport-errors.test.mjs`. Fourteen focused tests passed in an isolated JavaScript harness against the actual GitHub source; this is not an end-to-end playback test or verification of GitHub Actions.
- This does not bypass upstream IP restrictions or provider limits. A real permitted source still needs a live/movie/episode playback test from the production Railway network before customer traffic switches to the separate MediaMTX engine.


## Serial Xtream import operations and recoverable queue (2026-11-07)
- Root operational risk: the prior /api/v1/admin/xtream/sync-all loop launched all enabled sources concurrently; one large Xtream catalog could hold PostgreSQL connections while multiple sources made upstream requests. Logs around 09:35 UTC still reported a source transport reset. This is not proof of a BLOFY transport-only defect.
- New process-local xtream-sync-queue.mjs limits bulk catalog imports to one active source and sixteen waiting sources. The queue is FIFO, duplicate-source requests are rejected, failed imports do not block subsequent sources, and queue exhaustion returns HTTP 429 for manual requests. Existing source pause/delete/cancel actions remove queued imports and cancel running imports; no subscriber tables or public media URLs were changed.
- The operator panel clearly distinguishes "مزامنة جارية" from "في انتظار المزامنة"; active and queued counts are shown separately. A stale database "syncing" state after an interrupted process now has its own operator warning and can be cleared using the existing cancel action rather than being counted as an active job.
- New regression coverage: services/activation/test/xtream-sync-queue.test.mjs. Nine focused queue tests passed in an independent JavaScript evaluation; no direct real-feed playback assertion has been made.
- The queue is process-local. Running more than one portal replica requires a shared distributed queue/lease mechanism before parallel replica scaling; this release does not claim distributed safety.
- Previous known successful production commit for rollback: 5b0faaf8a67aa6aa7153dde5f9521c2f314a5519. No customer traffic was cut over to MediaMTX.
