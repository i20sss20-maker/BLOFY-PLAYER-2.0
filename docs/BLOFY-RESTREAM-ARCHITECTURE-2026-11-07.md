# BLOFY STREAM — Safe Restream Architecture (Research & Implementation Plan)
Date: 2026-11-07
Status: DESIGN ONLY, on isolated branch. No production deployment authorized by this document.

## Goals
- Keep the current production Xtream credentials, subscriber IDs, catalog and endpoint contracts intact.
- Restore/preserve known-good live and VOD paths before changing series playback.
- Only distribute media for which the operator has explicit authorization to rebroadcast.
- Do not circumvent origin restrictions or licensing/concurrency limits.

## Reference designs
- MediaMTX: multi-protocol ingest/playback, on-demand publisher, JWT/HTTP auth, control API, metrics; https://mediamtx.org/docs/kickoff/introduction and https://mediamtx.org/docs/features/hooks
- SRS: RTMP, SRT, WebRTC, HLS and HTTP-FLV, control API and monitoring; https://ossrs.net/lts/en-us/docs/v5/doc/introduction
- Flussonic: redundant authorized inputs, source failover; https://flussonic.com/doc/fms/protocols/sources/
- FFmpeg: stream copy/remux (`-c copy`) instead of costly transcoding when codecs permit; https://ffmpeg.org/ffmpeg.html
- CDN/origin shield caching for separately cacheable HLS segments, never indiscriminate credentialed API responses: https://docs.aws.amazon.com/mediatailor/latest/ug/cdn-emp-caching.html

## Architecture
BLOFY PLAYER -> existing Auth & Xtream middleware -> session/playback router:
  LIVE:
   - Legacy passthrough remains default (no behavior changes).
   - Optional authorized MediaMTX/SRS sidecar: on-demand *one input per channel* with reference counted viewers; demux/remux without reencode; HLS/TS output as compatible.
   - Channel-scoped circuit breaker / keyframe-aware permitted backup input only where contractual backup exists.
  VOD:
   - Keep HTTP range pass-through (206 and 416 preserved), content-type and content-range correct. No ffmpeg by default.
   - Never cache credential-bearing unpartitioned URLs. On origin fail, fail explicitly without changing IDs.
  SERIES:
   - Authoritative get_series_info and season/episode mapping; do not substitute adjacent numeric IDs.
   - Validate extension and canonical source episode ID; patch only series resolver.
  CONTROL:
   - Immutable versioned catalog / atomic generation swap.
   - Per-source, per-kind independent health and backoff; manual test distinct from full index.
   - Clear differentiation: DNS, TCP reset, provider 401/403/404/456/429, invalid metadata, no media, range mismatch, gateway 502.
   - No repeated source-wide scraping/index jobs when source offline.

## Initial implementation stages (not yet shipped)
1. Snapshot & smoke tests: pin known-good production build, record source-isolated tests for LIVE, MOVIE, SERIES. Keep rollback.
2. Add **read-only** safe diagnostics: method, source pseudonymous ID, media kind, upstream HTTP status, elapsed time, bytes-to-first-frame, and fixed reason code; no secrets or raw origin URLs.
3. Isolated series fix: test real provider-declared episode/container and range semantics; leave live/movie unchanged.
4. Optional MediaMTX proof of concept using owned/licensed sample stream only in separate staging service; measure startup, reconnect, bandwidth and shutdown. Do NOT route production traffic until operator approves and tests pass.
5. Staged opt-in rollout, feature flags, compare success rate to legacy and rollback on regression.

## Acceptance gates
- 100% unchanged successful legacy live and VOD golden tests (including nonzero seeking).
- No newly introduced production 502 from a code-only change.
- Per-source fair requests, bounded retries without bypassing upstream denial.
- No credential exposure in logs or public API, no origin relay unless authorized.
- Clear UI verdict: Source API online != media playability; "unknown" != "broken".
- At least one reproducible end-to-end series episode playback test before promoting.
- Source transport tests are deferred until operator's planned next-day testing.

## Not recommended
- Sending every stream into a separate FFmpeg transcode process; capacity and cost explode.
- Pretending a 200 metadata response proves actual video playback.
- Global rollbacks/migrations to fix individual episode issues.
- IP/proxy tricks to evade provider blocks or contractual access limits.
