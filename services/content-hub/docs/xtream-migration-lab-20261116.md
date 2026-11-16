# BLOFY XTREAM MIGRATION LAB — Test acceptance (16 Nov 2026)

**Not a catalog import or subscriber release.** The only copied media in this
experiment is locally generated, synthetic FFmpeg audio/video. No Xtream
credentials were mounted and there were **0 source-media requests**.

## Independent Railway resources

- Project: `BLOFY-XTREAM-MIGRATION-LAB`, id `538a56fa-cdbb-49ba-9620-d350dcdc6aa4`.
- Environment: `test`, id `14dca924-9caf-46c1-804d-3cd4f9a141e9`.
- Private T3 bucket: `blofy-xtream-migration-test-media`, id
  `a4ab2a47-c45d-4555-8da3-1cea361bf4dd`, region `ams`.
- Live lab: `blofy-migration-live-lab`, MediaMTX 1.19.2-ffmpeg,
  isolated publishing source `demo`; FFmpeg generates a moving test
  pattern plus 880Hz audio (H264/AAC), then MediaMTX muxes into HLS.
  Test-only HLS: `https://blofy-migration-live-lab-test.up.railway.app/demo/index.m3u8`.
- VOD QA: `blofy-migration-vod-qa`, pinned commit
  `02fc85446201270fc860fdf3d1dc763783787ded`, no public domain,
  one-shot run, restart policy NEVER. The test checks exact project/environment
  + physical bucket identity, refuses provider credentials and subscriber
  storage, and requires explicit synthetic-only flags.

## Real Railway three-way synthetic result

- Deployment `7708dc15-1bbd-403d-afa5-f56abaeda521`: **SUCCESS**.
- Runtime record `BLOFY_MIGRATION_LAB_AV_SMOKE`:
  `ok=true`, `code=migration_lab_all_three_synthetic_media_verified`,
  `movieVerified=true`, `episodeVerified=true`, `liveVerified=true`,
  `liveAudioVideoDecoded=true`, `movieReadbackSha256=true`,
  `episodeReadbackSha256=true`, `storageCleaned=true`,
  `s3ObjectsAfter=0`, `totalSyntheticBytesWritten=10486014`,
  `sourceRequests=0`, `automaticCopy=false`, `customerCutover=false`.
- Each private VOD item used a generated local MPEG4/AAC MP4 of 5,243,007 bytes,
  persisted through Railway T3 multipart upload, exact SHA-256 readback,
  cross-part byte-range verification and independent FFmpeg audio + video
  decoding, followed by exact-key cleanup.
- A separate real MediaMTX service generated the synthetic H264/AAC live feed;
  the test worker fetched its HLS via **private Railway DNS** and both FFprobe
  and FFmpeg recognized/decoded its video and audio. MediaMTX logged an HLS
  muxer/session with two tracks. This is **not** an actual Xtream live channel.
- Storage at-rest encryption is **Railway platform documentation only**;
  no per-object `ServerSideEncryption: AES256` HEAD response was verified.
- Production `blofy-activation-portal`, `blofy-content-hub` and the original
  PostgreSQL service remained on their prior successful deployments.

## What a full authorized Xtream transfer needs

1. **Inventory** all live, movie, series, season and episode IDs from the
   exact approved source; deduplicate, preserve EPG/category/poster metadata
   and record a durable source-ID + version map. Do not assume a count from
   another catalog (e.g. `BLOFY-SOURCES-XTREAM`).
2. **Rights and capacity gates:** independently document persistent storage,
   streaming/distribution territory and channel relay rights for each
   collection/title; verify source connection/bandwidth capacity, private
   S3 budget/usage, egress cost and available worker resources before any
   real origin download. Existing origin connection-reset logs are unresolved.
3. **Movies/episodes:** use checkpointed 8 MiB SHA-256 chunks, full final hash,
   source version validator, resumable queue, retry/backoff, quarantine,
   original-language audio and owner-only HTTP Range. Existing pilot has a
   4 GiB preflight ceiling and 128 MiB automatic session limit; it is **not**
   a full-library importer. Remove those limitations only with tested,
   bounded multi-session accounting, never by disabling integrity gates.
4. **Live channels:** a live channel is not a finite file. A licensed source
   should feed one controlled shared ingest/relay with HLS (optionally a
   bounded timeshift archive when rights allow). On-demand activation,
   explicit concurrency/health limits, no one-source-connection-per-viewer
   explosion, replay verification and expiry/recovery handling are needed.
5. **Daily sync:** compare catalog revisions at 04:00 Asia/Riyadh, queue only
   new/changed licensed VOD, update live endpoint and EPG metadata; record
   tombstones without deleting verified media until an explicit retention
   review. No auto-copy of the entire Xtream catalog by default.
6. **Acceptance before release:** one explicitly authorized real movie,
   one episode and one live channel on the isolated test stack; verify
   long playback, audio tracks, seek, source reset behavior, Windows and
   Android TV/Android 9; then staged batches with budget and concurrency
   caps. Never cut over subscriber traffic on a synthetic result.

## Decision

**Synthetic proof: PASSED for all three media categories.**
**Actual Xtream full mirror: NOT STARTED; NOT LICENSED/MEASURED; NOT APPROVED.**
Keep subscriber routes and automatic source-transfer flags OFF until the
independent per-source authorization, headroom, cost and real-device gates
are satisfied.


## 16 Nov 17:36 Riyadh — on-demand shared-live concurrency canary

- The isolated lab MediaMTX was configured with a separate `canary` path
  using `runOnDemand` instead of a permanent provider ingest. The publisher
  uses only local generated test frames (H264) and tone (AAC), with at most
  three test readers. Official MediaMTX docs confirm this on-demand hook
  is started by a reader and ends after readers depart.
- Independent QA script
  `scripts/railway-migration-on-demand-smoke.mjs` opened **two concurrent
  FFmpeg HLS readers** over Railway private DNS, each decoding 2s of video
  AND audio. It refuses any non-test project, environment, or synthetic flag.
- Actual Railway deployment
  `97e504af-a18d-4fbe-9320-2a8eb2b2da2f` finished SUCCESS, logged
  `BLOFY_MIGRATION_ON_DEMAND_SMOKE`:
  `ok=true`, `code=canary_two_viewers_decoded`,
  `viewersTested=2`, `passedViewers=2`, `customerCutover=false`,
  `sourceMediaRequests=0`.
- Concurrent MediaMTX runtime logs show **one** `runOnDemand command
  started`, **one** RTSP publishing session to `canary`, and **two**
  simultaneous HLS reader sessions. This supports one shared synthetic
  ingest for two clients. It does NOT prove a provider will allow 2
  real subscribers, 10 viewers, long-running stability, or the absence
  of external session limits. The runner itself deliberately reports
  `actualPublisherCountVerified=false`; the separate runtime log
  provides observational single-publisher evidence only.
- No Xtream source keys/URLs, customer codes, customer playback routes or
  production volume objects were used or changed.
- Existing server `blofy-migration-live-lab-test.up.railway.app` is
  test-only. Real source relay remains gated on demonstrable origin
  permissions, fresh capacity and connection-reset diagnosis.
