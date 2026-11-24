# BLOFY STREAM 1.0 — production Web/Media safe-segment delivery rollout
Date: 2026-11-24 (Asia/Riyadh). Approved changes from merged PR #857, SHA `f9fc1ec8f09ca9fd2d9fdb5778c0806ecd115f0e`.

## Authorized service targets only
- Official website: `blofy-stream-web`, Railway ID `f109c5f9-b81d-460d-81e5-175cc9b3df18`.
- Official private media worker: `blofy-stream-web-media`, Railway ID `63d4951c-4cda-4879-97cb-01c6700e02c7`.
- Both belong to isolated Railway project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Do not modify Android, subscription DB or authorization; no customer tokens or source URLs.
- Preserve worker credentials and immutable previous successful deployment for rollback.

## Improvements
- Bounded memory during large HLS, legacy VOD and full seekable VOD MPEG-TS delivery: file-backed `Bun.file()` and Blob Response streaming rather than full JS `readFileSync` per viewer.
- Do not expose an HTTP 200 for missing/empty file; remain private no-store for live and legacy video; VOD's existing private 3600s segment cache remains intact.
- On two-job encoder saturation, private worker returns `Retry-After: 5` for HLS and VOD. Website relays only numeric 1–30 seconds, never arbitrary headers.
- Full-length VOD waits 5s, then 8.5s for at most two capacity retries, with visible user status and no retry storm. It resets budget on a successful HLS fragment.
- Two simultaneous FFmpeg conversions remain the safe default. No change to transcoding quality, cross-account fanout, live transport or source credentials.

## Test evidence
- PR #857: complete official Web Github Actions SUCCESS (Chrome UI including MPEGTS, seek and remote; media lifecycle Node, 11-minute synthetic audio, official auth smoke).
- Targeted media lifecycle and file/memory response tests SUCCESS, including an actual Bun HTTP server with eight concurrent synthetic 188-byte-packet TS readers.
- These validate **file delivery**, not eight simultaneous encoders or customer-source 20m tests; real capacity and physical Toshiba/VIDAA QA remain unproven. No misleading 100% stability claim.
