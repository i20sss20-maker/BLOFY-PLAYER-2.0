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


## 16 Nov 17:44 Riyadh — five parallel viewers, two separate waves

- Hardened one isolated `canary` MediaMTX path (not the provider Xtream)
  to `maxReaders=6` for a **bounded five-viewer** synthetic test.
  No provider credentials, access to subscriber databases, or automatic
  media copying were introduced.
- QA runner `railway-migration-on-demand-smoke.mjs`, commit
  `34c2c3eb83678148bc3ce9ceca4d43e8069fd82b`,
  concurrently launched **five** FFmpeg readers, each requiring
  `0:v:0` H264 and `0:a:0` AAC decode for **8 seconds**.
- Railway deployment `f1b05707-c167-4ab3-9669-05423f712c47`:
  **SUCCESS**; `code=canary_five_viewers_decoded`,
  `passedViewers=5`, `viewersTested=5`, `elapsedMs=9955`,
  `automaticCopy=false`, `customerCutover=false`.
- Independently inspected MediaMTX runtime at 14:41:35 UTC:
  **one** `runOnDemand` startup, **one** RTSP publishing session,
  **five** distinct HLS sessions, two A/V tracks.
- After the readers left, the server logged muxer destruction
  at 14:42:55 UTC and `runOnDemand command stopped: not needed by anyone`
  at 14:43:03 UTC. This demonstrates the idle shutdown **for this test**.
- Restarted the **same pinned QA build**, leaving MediaMTX running, to
  verify reopening after the idle stop:
  deployment `6fbb933c-3094-481b-884e-c41b9baf621a`:
  **SUCCESS**, five out of five FFmpeg readers again decoded A/V
  (`elapsedMs=9917`). MediaMTX logs at 14:43:46 UTC again show
  one on-demand startup, one RTSP publishing session and five HLS sessions.
  The test runner deliberately reports
  `independentPublisherCountVerified=false` because single-publisher
  evidence comes from separate MediaMTX runtime logs.
- The service's existing external HLS port remains the only mapped public
  port; all headless FFmpeg test clients used Railway **private DNS**.
- These results cover two short, synthetic, low-resolution waves. They
  **do not** prove real-provider license, capacity, >5 clients,
  sustained streaming, original audio languages or Android/Windows
  device playback. The existing real Xtream `saleh` origin has previously
  produced `xtream_transport_connection_reset`. No real Xtream transfer
  was started or cut over.
- After the test the baseline Railway production Content Hub, Portal and
  BLOFY STREAM API deploys still reported SUCCESS. The S3 synthetic movie
  and episode acceptance from earlier was untouched.

Next gate: verify actual source storage + redistribution license evidence,
per-account upstream headroom and private S3 budget, then run one approved
real channel + movie + episode in isolation with long-playback and device
acceptance. Do not infer those permissions from an activated Xtream login.


## 16 November — 30-second synthetic endurance and public device test

### Five concurrent HLS viewers, real Railway test service
- QA commit 98e99fb970d3e041ad281f870fac6e4b08c379f5;
  Railway deployment ce54e61b-b419-46c2-aff9-48d408e6183d.
- Result BLOFY_MIGRATION_ENDURANCE_SMOKE was OK: 5/5 FFmpeg
  viewers each decoded 30 actual seconds, at least 450 video frames,
  audio and video mapped, duration proof verified, elapsed 32231 ms.
- Source was locally generated H264/AAC only, zero Xtream requests.
  This is not a real provider load or permission test.

### Browser/device-facing synthetic test page
- Separate isolated service blofy-migration-device-preview,
  ID 9a30c052-0a87-44c1-babf-3800ca276775, test environment.
- Railway-managed HTTPS URL:
  https://blofy-migration-device-preview-test.up.railway.app/
- Generated two local H264/AAC MP4 samples: 8-second movie (322974
  bytes), 11-second episode (437948 bytes). There is also a synthetic
  on-demand live HLS player. No real source media or customer content.
- Preview deployment 19462e28-291e-4f18-90f0-feee40622898 SUCCESS;
  startup log BLOFY_MIGRATION_DEVICE_QA_READY reported two files and
  zero provider media requests.
- Independent Railway private HTTP QA deployment
  66340325-8e37-4218-be72-15daa8b88205 SUCCESS: both MP4 files
  passed HEAD, exact HTTP 206 partial byte reading, suffix range,
  416 invalid range, FFprobe audio/video track recognition,
  FFmpeg audio/video decoding and timestamp-seek frame decoding.
- Independent Railway public HTTPS QA deployment
  8b3ab051-4e76-4639-90b0-b0b77e46b509 SUCCESS: result
  public_synthetic_https_preview_verified with
  publicHttpsVerified=true, previewPageVerified=true,
  mp4RangesVerified=2, providerMediaRequests=0,
  customerCutover=false, devicePlaybackVerified=false.
  The test called the exact Railway-generated public domain over TLS.
  This does not yet prove a user's own phone, browser or Android TV playback.

### No change to subscriber routes
The real Xtream source remains untested for persistent copying or
redistribution rights and origin source headroom, and has recorded
connection resets. Both the live and VOD assets above are SYNTHETIC.
Do not merge this draft, enable automated source transfer, or cut over
customers without verified authorization and a real isolated item canary.
