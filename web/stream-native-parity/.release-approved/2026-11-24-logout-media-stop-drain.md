# BLOFY STREAM Web 1.0 — Approved Authenticated Media STOP Drain
Release date: 2026-11-24 Asia/Riyadh. Merged PR #870, merge commit `f6dc928c528365f7c5987a35ef713789fb942135`.

## Scope and evidence
- Railway Web HTTP logs showed six repeated `/api/logout` 200 followed about 2 seconds later by `/api/hls/live/31/ts/0/stop` 401. Client logout cleared HttpOnly auth before asynchronous media close request arrived.
- Client now closes player before logout, tracks pending POST */stop requests with correct epoch/error accounting, and waits bounded 3.5 seconds before clearing auth. Logout cannot hang indefinitely if origin/network fails.
- Dedicated STOP-drain Node regression passed within official Chrome/media QA.
- PR #870 official Web 1.0 workflow SUCCESS; first playable segment, dual-engine recovery, first frame, freeze guard, backpressure/capacity, VOD transcoder handoff and encoder benchmark workflow SUCCESS.
- Unrelated Android CI failure in TV/manifest verification; no Android files changed. No claim of real subscriber/Toshiba/VIDAA 20-minute soak.
- Production web remains authenticated. STOP endpoint retains existing authentication and ownership checks. Worker capacity remains 2 jobs.

## Approved deploy only
- Railway project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`, service `f109c5f9-b81d-460d-81e5-175cc9b3df18` (`blofy-stream-web`).
- Do not deploy/restart isolated worker `63d4951c-4cda-4879-97cb-01c6700e02c7`, native Android, activation, billing, Xtream providers or any other services.
- Previous successful web deployment `fef6f944-7c2b-4b2a-a20b-8a06add31f10`, commit `35d17aef6d518aa8d6b5c7b75330da3c3283c856`, is the immediate rollback target.
- After rollout verify Railway healthy replica and HTTP success. Field long-watch acceptance remains pending.
