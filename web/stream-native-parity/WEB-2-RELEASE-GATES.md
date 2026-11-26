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
