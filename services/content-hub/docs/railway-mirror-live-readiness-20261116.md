# BLOFY STREAM — Railway production mirror readiness (2026-11-16)

**Scope:** READ-ONLY inspection. No real Xtream media fetched, no S3 object
uploaded or deleted, no production deployment, no customer routing change.

## Railway inventory actually observed

- Railway project `BLOFY-Update-Distribution`, production environment.
- `blofy-content-hub` and `blofy-activation-portal`: Online,
  latest settled deployment SUCCESS; one replica each in `ams`.
  Both remain on `qa/stream-timeline-keep-arabic-audio-20261115`.
- All six project services Online; no active warnings/criticals or
  failed deployments in the inspected preceding eight-hour window.
- The existing private Railway bucket `blofy-content-hub-private`
  is LIVE in region `ams`. S3 endpoint host `t3.storageapi.dev`,
  region setting `auto`, **virtual-host** addressing.
- Content Hub has S3 endpoint/bucket/region/url style and credentials
  variable names configured. Credential **values are redacted** to this
  connector and have NOT been tested against the live bucket today.
- Content Hub deploy config: **one CPU, approximately 1 GB RAM**.
  24-hour reported CPU/memory use was low at baseline, **not** a
  streaming stress test or guarantee of copy bandwidth/headroom.
- Activation Portal had 1,759 requests in the last eight hours:
  1,252 HTTP 2xx, 507 HTTP 4xx, **0 HTTP 5xx**. This does not
  measure upstream source reliability.
- Portal deploy logs show two `xtream_transport_connection_reset`
  relay errors at 2026-11-16 03:33 UTC and 03:36 UTC.
  Source stability therefore remains a live-test blocker until verified.
- Previous full *physical size-only* audit reported 350 movie and 173
  episode chunk objects with matching S3 HEAD sizes on Nov 15.
  That is not today's full-byte SHA check or proof of copying rights.
- Actual current S3 capacity/usage/budget, an isolated licensed sample
  manifest, and available upstream Xtream connections remain UNKNOWN.

## Work completed without touching production

- CI acceptance uses synthetic generated movie+episode MPEG4/AAC,
  PostgreSQL 16 and MinIO S3 with server-side encryption and FFmpeg.
- The isolated MinIO job now exercises production-style **virtual-host**
  addressing (distinct from the earlier path-style). A build-step
  middleware ASSERTS that multipart uploads, GET, HEAD and ListObjects
  actually target `blofy-ci-virtualhost.localhost`, instead of
  silently falling back to path-style. Real MinIO+PostgreSQL+FFmpeg
  CI passed on 2026-11-16. This proves the AWS SDK request host
  selection in CI, NOT live T3 permissions, storage quota or egress.
- The new Xtream mirror remains on GitHub **draft** PR #637, companion
  operator changes draft PR #107. All automatic copying switches
  default OFF and are not provisioned on the live branches.

## Hard release gates (none may be inferred from this report)

1. Obtain independent, documentable permanent storage / distribution
   rights for the exact movie/episode source to be mirrored; an Xtream
   login or self-entered license reference is not sufficient.
2. Measure actual private Railway S3 usage, list permissions, multipart
   encryption, consistency and cost budget using isolated synthetic
   writes/read-back/cleanup; keep production subscriber objects intact.
3. Check fresh provider concurrency/bandwidth headroom and investigate
   source connection resets; do NOT use live customer codes as a probe.
4. In a separate isolated Railway test service/environment (rather
   than the subscriber's current production branch), test ONE
   explicitly licensed movie and ONE episode, each with 206 Range,
   8MiB checkpoint/resume, full SHA, ffprobe/ffmpeg audio+video decode.
5. Test private HTTP seek and target Android/Windows playback with
   real authorized media. Only then consider gradual deployment and
   independently gated scheduled copying of allowed titles.

**Decision:** NOT READY for real Xtream bulk copying, daily full-catalog
mirroring, public app switch, or production branch change.

**No sensitive tokens or credential values recorded in this file.**


## Isolated Railway T3 S3 live synthetic smoke — 16 Nov 2026

- Provisioned a NEW independent QA-only bucket in the existing
  production Railway project, NOT the subscriber Content Hub bucket:
  `blofy-mirror-s3-isolated-qa` (region `ams`, S3 T3, `virtual-host`).
- Provisioned QA-only service `blofy-mirror-s3-qa`, one-shot pinned to
  development commit, root `services/content-hub`, Node runner
  `scripts/railway-isolated-s3-smoke.mjs`, restart policy NEVER,
  max CPU 0.25 and memory 0.5 GB. It has only the fresh QA bucket
  references, no Xtream credentials, no production PostgreSQL access.
- Safety flags: BLOFY_QA_SYNTHETIC_ONLY=1 and
  BLOFY_QA_ISOLATED_BUCKET=1; expected bucket identity must match
  the target. Refuses ALL writes unless private S3 usage listing
  confirms bucket had ZERO objects/bytes and no active multipart.
- Actual successful Railway deployment `9a9f9e07-084a-45de-adf2-49c4f12ac1e4`
  logged result `qa_isolated_s3_verified_platform_at_rest_docs_not_api_proof`.
  Real T3 wrote 5,243,007 synthetic random bytes in TWO multipart
  parts (5 MiB + 127 B), verified HEAD size, entire SHA-256 hash
  and exact ranged bytes crossing the part boundary, then deleted
  ONLY its own object and confirmed empty QA bucket (0 objects).
  This test used real Railway T3 and credentials via bucket references;
  not synthetic MinIO or an external provider.
- IMPORTANT encryption distinction: Railway Storage Buckets docs say
  S3 server-side encryption (SSE-S3) settings are not supported,
  while Railway Enterprise Security docs state all storage bucket
  data is encrypted at rest with AES-256 by the platform.
  Live T3 HeadObject did NOT return the AES256 SSE header, so this
  smoke can verify successful uploads/reads/cleanup, NOT object-level
  SSE-S3 proof. The result explicitly records
  `sseHeaderVerified=false`, `encrypted=false`,
  `platformEncryptionDocumented=true` with doc-only evidence.
  No inference that SSE-S3 or end-to-end customer-managed encryption
  has been verified or enabled.
- This does not test storage permissions or quota of the EXISTING
  customer Content Hub bucket, does not prove independent media
  copying/redistribution rights, and does not perform provider copy.
- Existing `blofy-content-hub` and `blofy-activation-portal` remained
  on the preceding production commit during all QA deployments.
- For a production real-file canary, independently verify per-item
  rights and source headroom first. Current Xtream transport reset
  logs remain unresolved. Keep all media-copy switches OFF.

References:
- https://docs.railway.com/storage-buckets
- https://docs.railway.com/enterprise/security


## Railway T3 synthetic video plus audio codec read-back (2026-11-16)

- Real isolated QA Railway deployment `c5c799ba-ee22-4359-be4b-3a522570f486`
  succeeded on the pinned developer commit `ceb253d6494681737858e9c0e47019cf87767618`.
- QA-only service `blofy-mirror-s3-qa` used new runner
  `services/content-hub/scripts/railway-isolated-av-smoke.mjs`
  and explicitly enabled `BLOFY_QA_SYNTHETIC_AV=1`.
- It GENERATED its own 2-second MPEG-4 visual test pattern
  (320x180@12fps) plus 880Hz AAC audio in MP4 using local FFmpeg.
  A valid MP4 free atom padded this file to exactly 5,243,007 B.
- The private QA bucket was confirmed EMPTY before any write.
  Real Railway T3 S3 accepted two multipart parts, and the runner
  checked HEAD length, full-file SHA-256, and a cross-part byte range.
- Crucially, a SECOND full-size private S3 HTTP RANGE read of the
  stored object was independently SHA-256 checked, written to a
  temporary local MP4 and decoded through real FFprobe and FFmpeg.
  BOTH audio samples and video frames successfully decoded.
- The isolated job removed only its own exact QA object, then
  checked bucket usage: `objectCountAfter=0`.
- Actual deployment log contained:
  `BLOFY_RAILWAY_ISOLATED_AV_SMOKE` with
  `ok=true`, `writtenBytes=5243007`, `fullShaVerified=true`,
  `rangeVerified=true`, `avVerified=true`,
  `independentS3AudioVideoDecoded=true`,
  `cleanedUp=true`, `objectCountAfter=0`,
  `sourceRequests=0`, and `devicePlaybackVerified=false`.
- No Xtream credentials, third-party media, customer playlists,
  production Content Hub bucket, or production PostgreSQL were used.
- Encryption result remains provider policy only:
  `encryptionEvidence=railway_platform_policy_docs_only`,
  `sseHeaderVerified=false` and `encrypted=false`. Do not claim
  object-level S3 SSE has been API-verified.
- This establishes real Railway T3 private A/V media viability
  in isolation; it is NOT a test of actual customer devices,
  full-length playback or any real Xtream media copy rights.
- Full production mirror and customer playback cutover remain OFF.

### CI note

- Isolated Content Hub/MinIO/PostgreSQL/FFmpeg CI passed on
  `ceb253d6494681737858e9c0e47019cf87767618`.
- An **unrelated** BLOFY Activation browser job `downloads-browser`
  failed in that commit: subscriber save UI did not render in time
  (`STROING 8K: ...`). Activation `verify` and admin session tests
  passed. This is a separate release blocker; do not merge blindly.


### Post-canary guard: pin real Railway QA to dedicated bucket

- The test runner now refuses all Railway Storage Buckets endpoints
  (`*.storageapi.dev`) unless the exact target bucket is
  `blofy-mirror-s3-isolated-qa`. This prevents accidental writes to
  the subscriber bucket if an environment reference gets changed.
- This bucket identity validation happens before S3 access or fixture
  generation, and the video validation mode additionally requires
  `BLOFY_QA_SYNTHETIC_AV=1` before any upload.
- Offline tests cover a misconfigured customer bucket, absent QA
  approval, corrupt S3 read-back and exact-key cleanup.
- The successful earlier real Railway A/V deployment is pinned to
  tested commit `ceb253d6494681737858e9c0e47019cf87767618`;
  subsequent hardening is in the draft branch, not a customer deploy.


## Railway real PostgreSQL + T3 full synthetic mirror acceptance (16 Nov 2026)

- For this test only, provisioned a SEPARATE managed PostgreSQL 18
  service `Postgres-aO7C` and its own new volume. Neither the
  customer's existing `Postgres` service nor existing Content Hub
  bucket was connected to the QA runner.
- New one-shot script `scripts/railway-mirror-pg-s3-qa.mjs` requires
  four explicit synthetic/isolated flags, pins the EXACT actual QA
  physical bucket name (UI label is not the physical S3 name),
  and verifies the separate PostgreSQL `.railway.internal` hostname
  matches an independently referenced expected QA service.
- Synthetic MP4 video + AAC test tone was created entirely within
  the QA container, padded to 8 MiB + 127 bytes to cross the
  8 MiB mirror part boundary, then exposed only via a local
  in-process HTTP 206 Range response. ZERO Xtream requests.
- Railway QA deployment `1d7cebd0-6283-4939-98e8-f189df53f7a9`
  proved both MOVIE and EPISODE media were saved and SHA-verified
  into real Railway T3 and separate PostgreSQL; the FFmpeg audio
  + video decoders also passed. Its final history step failed
  due to a QA call-site argument error; the test cleaned all rows
  and storage objects before the script exited.
- Fixed the history call signature and reran. Successful one-shot
  Railway deployment `4329c9de-7d15-412c-9c56-aad57229e01f`
  logged `qa_real_pg_s3_synthetic_movie_episode_verified` and
  `ok=true`, `movieVerified=true`, `episodeVerified=true`,
  `allSha256Verified=true`, `audioVideoDecoded=true`,
  `ownerSeekVerified=true`, `dbRowsCleaned=true`,
  `s3ObjectsCleaned=true`, `s3ObjectsAfter=0`,
  `sourceRequestsToXtream=0`, `customerCutover=false`,
  `devicePlaybackVerified=false`.
- The independent owner-only HTTP GET returned an exact byte
  range crossing the private 8 MiB S3 part boundary for BOTH
  movie and episode, with private manifest records from real
  PostgreSQL and actual FFmpeg decoding from the stored S3 bytes.
- The QA script deleted only its 2 exact PostgreSQL synthetic
  mirror rows, stored A/V sample records, and its 4 exact private
  S3 part objects. Confirmed zero remaining objects on QA S3.
- Latest GitHub CI for tested commit
  `11bb8d12b3bad5a11fb3ab40bdb1bec81902a5dc`
  passed Activation, Content Hub, Device Administration and Zid.
- No real Xtream copy, customer playback route switch, automated
  whole-library synchronization, device app playback or independent
  third-party permanent-storage rights verification occurred.

Next independent hard gates: verify a specific title's permanent
storage+distribution rights and fresh origin concurrency headroom;
then run ONE authorized real movie and episode in the isolated
pipeline and test Android/Windows end-device audio/video + seek.


### Post-QA cost/resource cleanup (same day)

- After verifying the final successful QA result, the only temporary
  PostgreSQL test service `Postgres-aO7C` and its separate 50,000-MB
  `postgres-volume-cMTi` were deleted from Railway. The original
  customer PostgreSQL service named exactly `Postgres`, and its
  original `postgres-volume` stayed untouched and healthy.
- The isolated QA service was returned to an inert one-shot start
  command `BLOFY_MIRROR_QA_IDLE` and
  `BLOFY_QA_REAL_PG_MIRROR=0`. QA database connection variables
  were blanked; restart policy remains NEVER. A finished one-shot
  container may show `CRASHED` in Railway despite completed
  successful smoke logs; it is NOT the customer Content Hub.
- The dedicated private QA bucket was retained for future synthetic
  tests, with zero objects after cleanup. The customer Content Hub
  bucket and existing production API deployment remain unchanged.
- Verified the Railway environment patch settled (no pending patch),
  temporary QA PostgreSQL service/volume absent, and production
  Content Hub, Activation Portal and original Postgres all SUCCESS.
