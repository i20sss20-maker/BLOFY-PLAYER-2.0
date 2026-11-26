# BLOFY STREAM WEB 2.0 — release gates
Production rollback anchors (verified deployed on 2026-11-26):
- Web ec7dc42af19ccf75b7e76bf9c2a8dc03eb43c4cb / Railway 925a4ad6-01d2-48d6-ad2e-9e0839d754e8.
- Media a0acd8725f649b456838160a0e6936979d2f2763 / Railway 9e22cf9c-8491-4b25-9fce-cee163cfe1e3.
These are known deployed builds, not certified long-play builds.
## Phase 1 candidate
- Control-plane limits, streamed body deadline, logout invalidation, session recovery, idempotent HLS stop, aggregate first-picture evidence.
- Gate: Docker QA and synthetic tests; authenticated staging only, no production change by this branch.
## Next release gates
1. Test channel switching A/B/C repeatedly, preview promotion, offline/online, returning from background, user pause and subscription expiry.
2. Use authorized test media: 30–60 minute live and VOD, cross-chunk seeks, audio fallback, external client handoff, and device matrix iOS Safari/PWA, Android Chrome, desktop and actual SRAF/VIDAA.
3. Measure first-picture distribution, actual freeze duration, success per playback attempt, request status and resource utilization; no rate inferred from event counts. Older devices without frame evidence are unknown.
4. Test expired/reused external ticket, logout race, slow/oversized body, rate budgets, account isolation and permission checks.
5. Separate audio worker only after staging proof; preserve licensed source and account connection limits. Failover requires a configured authorized backup.
6. Canary and rollback using prior build. No production load test, wider rollout, quota increase or source change without a bounded test plan.

## Private staging checkpoint — 2026-11-26
- Railway project BLOFY-WEB-2-STAGING (9501c37d-dd0c-44b5-90c6-5cb170d4e689), environment staging (6e3978de-c204-4dbc-8de6-6f7388b94ab1).
- Both services successfully deployed from 64b0df9bdc3ae64e8766bd3faa1c96f1a78758f1.
- Audio deployment 17483b0c-2187-49c7-940b-ad81d2854987: startup health passed, including synthetic AAC/TS to MP3 conversion.
- Web deployment 365fc5c2-8247-4d50-ad79-b8ff68e541b2: health initially 503 while audio initialized, then passed through internal private DNS. Readiness is dependency-aware.
- No public customer domain or production subscription secret was configured. Both services use synthetic-only mode and capped resources (1 vCPU, 0.5 GB each).
- Added integrated container QA for isolation, denied production API access, and dependency failure/recovery. Await its result; do not mark approved until green.
- The synthetic-only environment cannot demonstrate licensed-source playback, real iOS/Toshiba behavior, long-play QoE, or multi-source failover. Those remain required for production promotion.
- Keep production pinned to the rollback anchors above; no automatic promotion.

## Browser playback milestone
- Commit 3c1e56a9ef9fd1147b2c4f52dc36b7491089584d: all four web QA workflows passed (installed preview, isolated audio, staging integration, Chrome synthetic decoding).
- Actual Chrome test confirmed six decoded starts and five sequential switches, including transient STOP failure and retry. This is local synthetic HLS, not subscriber traffic.
- Web staging source updated to this verified commit. Audio staging remains on 64b0df9bdc3ae64e8766bd3faa1c96f1a78758f1 (same audio worker).
- Added 20-minute real-time generated live HLS soak, requiring decoded frame progress, advancing media clock and zero fatal errors. It is a separate QA gate, not yet a recorded pass.
- Android CI is independently red; do not promote Android or claim all repository checks are green.

## Latest integration milestone — 2026-11-26
- Candidate 7cb9e85667b6c78990e61b4d6231f7983e4fef79 deployed successfully to private staging (4a744a43-68e4-49c1-a43e-6750168cefa5).
- 48d63e43793e9e18e0a89730b271b645dfafc176: all four short web checks green; browser decoded five switches and sought forward/backward across three points. HTTP readiness burst: 100 requests, concurrency 10. Neither test demonstrates 100 simultaneous media viewers.
- Operator dashboard is opt-in with independent 256-bit key, absent by default; access via private network only during trial. Do not put the key in URLs or customer sessions.
- Long soak is a deliberate gate; use explicit PR label web-soak-approved or manual dispatch where supported. Existing running checks remain valid only for the tested commit and fixture.
## Physical acceptance checklist (unverified)
On authorized test accounts only, one stream per subscription unless its licensed capacity explicitly permits more:
1. Desktop Chrome/Edge, iOS Safari and installed PWA, Android Chrome and installed PWA, Toshiba/VIDAA TV: confirm code login, catalog, first picture and audible sound, 5 channel switches, 20–30 minutes live, 20–30 minutes VOD and forward/backward seeks. Record model/browser and candidate revision, elapsed viewing and observed freezes. Never attach credentials or stream URLs.
2. Test airplane mode/connection restore, background/foreground, deliberate pause and return. Check that no new session is allocated while offline/paused and no silent invalid subscription on 503.
3. Test commentator selection and listen for audio alignment; verify switching back to original audio and cleanup. No pass inferred from MP3 health check alone.
4. For fallback, require authorized independent backup and verified channel correspondence, provider quota and explicit test scope. Until then use same-source bounded recovery only.
5. Canary requires a separately authorized test entry, healthy worker, rollback anchor and real media evidence. If any physical gate fails, leave customer deployment pinned. No automated production promotion based on synthetic results.
