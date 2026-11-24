# BLOFY STREAM Web — urgent Docker runtime module inclusion

Release date: 2026-11-25 Asia/Riyadh.

The first post-PR #891 Railway deployment `3641444a-1e22-41d6-a08f-23514417898a` exposed a **real runtime packaging defect**: Dockerfile copied a fixed list of modules but omitted the new `hls-ios-live-profile.mjs`. Railway logs: `Cannot find module './hls-ios-live-profile.mjs' from '/app/server.ts'`. Existing prior healthy deployment continued serving during rollout.

Fixed Dockerfile to COPY the new module in release commit `e9644de4eeb81618c66b959716e795314f516e1e`. The code of PR #891 and associated successful web QA has not changed. This release approval file intentionally triggers web-service-only Railway source watch path, no media worker and no Android restart. The corrected container must pass healthcheck and real HTTP before accepted. Rollback service to prior healthy deployment `c2df1627-cf83-4f56-a142-f6a1b65665d2` if replacement is not healthy. Physical iPhone 20-minute video proof remains outstanding.
