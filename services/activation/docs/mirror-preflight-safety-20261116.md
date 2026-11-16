# BLOFY STREAM – staged media copy size preflight (16 Nov 2026)

This is **not** automatic ingestion and is **not a download queue**. The existing
`blofy_stream_mirror_intents` table stays metadata-only. This branch adds an
operator-only, per-item 4 KiB source range probe and a separate PostgreSQL
`blofy_stream_mirror_preflights` table for durable measured sizes.

## Current behavior

- An exact licensed, enabled, published `saleh` movie or indexed episode must
  already be staged in the owner-only mirror intake; no arbitrary source URL,
  IPTV credential, public API caller or unindexed file is accepted.
- The Portal's fixed signed BLOFY STREAM bridge accepts **POST**
  `/internal/blofy-stream/ops/mirror-intake/preflight` with the existing bridge
  Bearer token and an owner action header:
  `x-blofy-owner-action: probe-private-mirror-intake`.
- Body: `{"kind":"movie","id":"<indexed-id>","ownerConfirmed":true,
  "licenseReference":"<non-secret-source-license-reference>"}`.
  The license reference is hashed before persistence; never supply a password
  or any customer identifier.
- The source must have a strict, public, approved origin. Exactly one
  `Range: bytes=0-4095` is issued with an upper timeout and no redirect or
  plain-GET fallback; size is accepted only from a matching HTTP 206 response.
- A timed single-process lock and 30-second cooldown limit probing in the
  currently one-replica Portal. Source-idle **and** quiet-window confirmations
  are required even for this small probe to avoid disrupting playback.
- A fresh source validator (ETag or Last-Modified), per-item permanent-storage
  license evidence, and independently verified private bucket usage/budget are
  all required before an entry can become eligible. The Portal requests a
  **private signed** scan from Content Hub concurrently with the single source
  probe; if the scan or budget is unavailable it records measured size only.
- The Content Hub checks bucket versioning, unfinished multipart uploads, and
  paginates current object sizes (up to 10,000 objects). More than 10,000
  objects or a failed scan blocks eligibility; no guessed free-space number
  from the operator is ever accepted. The budget is a spending/capacity
  allocation, **not a promise that S3 has a fixed-size disk**.
- The response always reports `copyWorkerEnabled:false`,
  `mediaBytesTransferred:0`, `customerCutover:false`. No downloads, S3
  writes or customer routing modifications are performed.

## Deployment gates – all new flags default OFF

- `BLOFY_STREAM_MIRROR_PREFLIGHT_ENABLED=1` on the Portal (not set in
  production as part of this change).
- `BLOFY_STREAM_MIRROR_PREFLIGHT_SOURCE_IDLE_CONFIRMED=1` only during an
  observed source-idle period.
- `BLOFY_STREAM_MIRROR_PREFLIGHT_QUIET_WINDOW_CONFIRMED=1` only during a
  deliberately approved quiet window.
- Existing `BLOFY_STREAM_MIRROR_INTAKE_ENABLED=1` plus private manifest
  reconciliation must already be working.
- `BLOFY_CONTENT_HUB_MIRROR_CAPACITY_AUDIT_ENABLED=1` on the private
  Content Hub; defaults OFF.
- `BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES` must be an approved private
  storage cost allocation of at least 1 GiB. Without it, an S3 usage scan
  cannot authorize a transfer. This branch does not set a budget or enable it.

## Still required for actual automatic transfers

1. Validate the new signed private bucket usage scan against the real
   Railway S3 service and configure a reviewed budget. Until then size-only
   preflights stay blocked. Do not count unverified historical bucket versions.
2. Wire eligible rows to a **separate** durable one-worker copy scheduler,
   with a source-wide lease, current license recheck, SHA-256-verified
   private chunks, checkpoints, pause/resume, bounded retries and audit.
3. Prove one authorized new file with visible video and audible audio in
   client canaries before considering an automatic daily transfer sweep.
   Customer playback remains on its existing service throughout.

Run tests with `cd services/activation && node --test
test/xtream-mirror-transfer-preflight.test.mjs`. No live provider endpoint,
S3 bucket or subscriber path is accessed by the unit tests.


## 16 November: limited resumable worker code (DRAFT, not deployed)

The owner-only copy path is now implemented **in this feature branch only**.
This is no longer merely a queue design, but NO real file copy was triggered
and NO production feature switches were changed as part of the change.

- Portal: strict, private, token-protected approval lookup for one staged
  *saleh* item with an eligible recent preflight, exact catalog mapping,
  8 MiB–4 GiB size, nonempty rights-evidence SHA-256, and source validator.
- Portal: per-item private 206 source Range bridge, at most one upstream
  media request at a time, with no redirects, no fallback to full GET,
  exact source mapping and file-size validation.
- Content Hub: one 8 MiB S3 checkpoint per execution; it records source
  ETag/Last-Modified, validates every downloaded byte and independently
  reads back each private chunk's SHA-256. Final completion requires a
  separate full-file hash recomputed over ALL saved S3 chunks. A stored
  checkpoint survives worker restarts; verified files cannot be downloaded
  again under the same stable run ID.
- A **manually approved bounded background session** can start up to 16
  sequential chunks (128 MiB) or 20 minutes, whichever comes first, with
  3-second spacing. It supports explicit pause; it never auto-resumes after
  a restart. Every chunk rechecks private Portal approval and actual S3 usage.
  No customer playback or download destination is changed.
- BLOFY STREAM owner UI (companion BLOFY-SOURCES PR #107) shows an explicit
  size probe, limited transfer start, and pause. Read-only Content Hub status
  exposes session progress and the last checkpoint result.

### New gates (all OFF unless an operator separately authorizes them)

On **the private activation Portal**:
- BLOFY_CONTENT_HUB_MIRROR_BRIDGE_ENABLED=1
- BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED=1
- BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED=1
- BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED=1
- BLOFY_STREAM_MIRROR_TRANSFER_CONTROL_ENABLED=1
- Earlier metadata-intake, private manifest reconcile, and size preflight
  gates must also remain explicitly authorized.

On **the private Content Hub**:
- BLOFY_CONTENT_HUB_MIRROR_WORKER_ENABLED=1
- BLOFY_CONTENT_HUB_UPLOAD_ENABLED=1
- BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED=1
- BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED=1
- BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED=1
- BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES=<reviewed spending allocation>
- Correct private S3 credentials, Hub operator Bearer token and separate
  Portal data-plane bridge token. Never paste tokens into source code.

### Existing barriers to real automatic *daily* copying

- Verify the Railway bucket's S3 versioning/list APIs, account egress and
  fresh capacity snapshot against production without disturbing viewers.
- Demonstrate an owner-approved low-load canary of **one file**, including
  preserved audio and video and a valid full-file SHA-256. Capture source
  impact, paid S3 costs, and connection-limit evidence.
- A multi-item scheduler and daily VOD delta import are **not yet enabled**.
  The 04:00 Riyadh catalog metadata sync does NOT authorize bulk copying.
  Avoid assuming 100,000s of catalog entries have copy rights or capacity.
- Add progress/health alerts and controlled retry/pause/resume policy before
  any unattended jobs. There is still no subscriber cutover.

Developer offline verification: the normal activation and Content Hub CI
suites include mirror worker approval, private Range bridge contracts, S3
capacity and one/two-chunk resumable transfer tests.


## Daily reconciliation and durable owner statistics

- Existing Xtream metadata synchronization remains at 04:00 Asia/Riyadh.
- The new daily copy-plan is read-only. It requires the exact active
  approved source, a completed same-day catalog import, and active
  staged per-item preflights less than 30 minutes old. It displays
  exact blockers; it never starts a download or a subscriber cutover.
- Portal feature switch: BLOFY_STREAM_MIRROR_DAILY_PLAN_ENABLED=1.
  The switch defaults OFF.
- License-reference hashes currently represent owner attestations,
  NOT independent proof of permanent storage or redistribution rights.
- The private Hub mirror history endpoint lists recent verified,
  staged and failed persisted movie/episode copies with percentages,
  saved byte counts and bounded error codes, excluding unrelated
  pilot runs. It requires a private owner-action header.
- The companion STREAM operator UI displays the daily plan and
  durable mirror transfer progress/failures through signed bridges.

## Release status and remaining verification

- These changes live only in unmerged draft PRs #637 and #107.
- All GitHub tests are offline mocks. No new real provider video,
  private S3 transfer, quota scan or player A/V canary was performed.
- Validate legal storage rights for each file, source concurrency
  headroom, private S3 API compatibility/cost, and a real-file A/V
  canary before switching on recurring uploads.
- Imported Xtream metadata is not proof that the full catalog has
  been physically transferred to private storage.


## Verified private-S3 audio/video canary and exact movie gateway mapping

- Staging a movie now materializes exactly ONE source-scoped gateway map row
  if absent. The operation is idempotent and never scans/maps the whole
  Xtream library or starts playback/transfer. It uses the established
  indexed, enabled, published source and enabled category policy.
- Content Hub adds an owner-token-only POST /internal/mirror/copy/canary
  for a verified run ID matching mirror_<32 lowercase hexadecimal digits>
  and an explicit movie/episode kind. The existing private diagnostics
  independently reread a bounded sample (up to 32 MiB) from private S3,
  validate chunk SHA-256, probe audio/video tracks with ffprobe, and decode
  both video frames and audio samples with ffmpeg. No Xtream media bytes
  are requested; output is sanitized telemetry, not an accessible URL.
- The activation Portal requires the new explicit feature flag
  BLOFY_STREAM_MIRROR_AV_CANARY_ENABLED=1 and the exact owner action
  verify-private-mirror-audio-video. The default state is disabled.
- STREAM operator copy history now includes a canary button only on
  completed, SHA-verified mirror runs. Existing subscriber app routes
  are unchanged. The season worker source-busy check includes active
  mirror writers, preventing a competing copy session.
- Offline tests cover the real private prefix diagnostics with mocked
  S3 bytes and ffprobe/ffmpeg outputs, missing manifests, corrupted
  hashes, missing A/V tracks, exact movie mapping and signed API paths.

CAUTION: Passing offline canary tests is not proof that real S3 objects
or the real provider can be copied, decoded, stored legally, or served.
Both PRs remain DRAFT and UNDEPLOYED. Any real one-file canary must be
an individually authorized file under an explicit private capacity
budget and verified upstream source connection headroom.


## Hardening: versioned immutable VOD copies and crash-safe completion

- A preflight now hashes the exact upstream 206 strong ETag or (if no
  strong ETag) Last-Modified version evidence. A weak-only ETag is
  rejected as insufficient to verify an immutable full byte stream.
  Only its SHA-256 digest is persisted in PostgreSQL. The raw upstream
  validator, credentials, and video URLs are never returned to owner UI.
- Every owner-scoped Range request independently hashes and compares
  its validator to the staged preflight fingerprint BEFORE forwarding
  any source bytes to the private worker.
- Mirror worker also compares the returned validator digest and refuses
  to write a part on a mismatch. Run IDs now depend on source identity,
  catalog item, exact source-validator SHA-256, file size, and owner
  rights-evidence digest. A new source version creates a distinct
  immutable run rather than incorrectly reusing an old verified copy.
- A transient S3 timeout during final whole-file re-verification leaves
  every SHA-verified PostgreSQL checkpoint intact. The next authorized
  invocation finalizes from saved private parts with zero new Xtream
  requests or S3 writes. Detected S3 hash/manifest mismatches remain
  terminal failures.
- Mirror, season, episode and existing film copy starts and explicit
  next-chunk operations now check the other workers' active state;
  source-wide PG advisory locks continue to enforce cross-instance
  serialization. No production flags or customer routing were changed.

All of these additions are offline-tested draft changes. Source
version hashes are consistency hints, not a rights license or proof
that the source will continue serving the file tomorrow. Real
one-file and capacity tests are still required before production.


## Crash-consistent checkpoint safety and cached source headroom

- A deterministic private S3 key may already exist after a PostgreSQL
  checkpoint commit acknowledgement was lost. Each new attempt HEADs
  that exact key and independently verifies its bytes + SHA-256 before
  reuse; it refuses to overwrite any existing mismatching/unknown key.
- If the DB checkpoint write times out, the verified object is retained
  for reconciliation, NOT deleted: a timed-out query may actually have
  committed. A confirmed DB acknowledgement clears the uncertain state.
- A retry may read the exact source range again to compute its SHA but
  can reuse the already-verified object with ZERO duplicate S3 writes.
  Completed checkpoints, source versions and customer routes are not
  changed. This new branch has offline tests for both pre-commit and
  post-commit errors and for corrupt/unknown S3 HEAD replies.
- The strict source headroom gate uses ONLY cached provider account
  connection limits, its last explicit test time and current HTTP
  transfers observed by the SAME Portal process; it performs no
  new Xtream connection probe. It fails closed on stale snapshots,
  unreliable gauge, absent restream permission flag, any currently
  active direct source transfer or fewer than TWO reported spare
  connections. The new Portal-only switch
  BLOFY_CONTENT_HUB_MIRROR_SOURCE_HEADROOM_ENABLED=1 is required.
- This measurement is explicitly incomplete: it excludes other Railway
  replicas, upstream relays and HLS segment traffic, and cannot prove
  commercial or storage rights. It is a cautious operational veto,
  not a guarantee that customers will never experience upstream load.
- STREAM operator UI reads the same provider snapshot using the new
  GET /internal/blofy-stream/ops/mirror-intake/headroom route with
  explicit blocked reasons and zero new provider/media requests.

Release remains DRAFT, all copy/headroom flags default OFF. Live
production services are unchanged; run one authorized source/S3 canary
only after explicit per-file storage rights and external headroom review.


## Database-backed checkpoint acceptance test

- The CI workflow `content-hub-pilot-ci.yml` now runs an integration
  test against a disposable PostgreSQL 16 service (not a mock DB).
  It uses synthetic 8MiB + 127B movie bytes, fake in-memory S3, and
  a fake 206 media stream. It NEVER contacts real Xtream, production
  Railway, user accounts or a paid cloud S3 bucket.
- Test deliberately simulates a PostgreSQL checkpoint that commits but
  loses its acknowledgement. The exact verified S3 part must be retained;
  a subsequent worker invocation resumes from part #2, proves the
  full-file SHA-256 and marks the actual PostgreSQL manifest verified.
- New mirror history is filtered using exact `mirror_` run IDs in SQL
  BEFORE pagination. Prior pilot runs can no longer hide current mirror
  status, and recent checkpoint ordering follows `updated_at`.
- The mirror's PostgreSQL checkpoint validator is the SHA-256 digest
  of the upstream version, never the raw ETag / Last-Modified header.
- Production requirements are unchanged: independently verify per-item
  copying rights, private-bucket API support and cost budget, enough
  upstream headroom, and real A/V + device playback before any rollout.

These tests prove database consistency with synthetic data only. They
do not prove real provider/S3 compatibility and must not be called a
successful real-file copy.


## S3 wire protocol + real PostgreSQL integration (2026-11-16)

- A dedicated GitHub Actions mirror-minio-postgres job now exercises
  the actual mirror worker against real PostgreSQL 16 and the MinIO
  S3-compatible HTTP server, through the production private-s3.mjs
  adapter: multipart begin / UploadPart / CompleteMultipartUpload,
  HEAD, ListObjects, GetObject Range, SHA-256, and DeleteObject.
- Provider Range responses are generated locally from one SYNTHETIC
  8 MiB + 127 byte fixture; no Xtream, subscriber, paid cloud bucket,
  or Railway production service is ever contacted by this test.
- Two private S3 objects are uploaded, checkpointed in PostgreSQL,
  and independently SHA-256 verified as the exact original bytes.
  Repeating a completed run produces zero additional source calls
  or S3 uploads; advisory locking prevents simultaneous copy starts.
- The CI container uses the maintained public Chainguard MinIO image
  instead of withdrawn official Docker Hub and Quay images. An
  ephemeral random test-only static KMS key supports the adapter's
  mandatory AES256 SSE-S3 multipart encryption. Production encryption
  remains mandatory and unchanged.
- 2026-11-16 CI passed: guarded-mirror, postgres-season-analytics,
  mirror-minio-postgres, Activation CI, Device Administration,
  and Zid activation integration.

Remaining rollout blockers: this is a SYNTHETIC test of real S3 API
and real PostgreSQL, not a Railway production bucket test or real
provider video transfer. It does not prove permanent copying rights
for third-party media or device playback quality. All mirror flags
remain OFF and all drafts remain undeployed.


## Full synthetic audio-video canary through real MinIO + PostgreSQL

- Integration CI now generates a real 2-second video+sound clip LOCALLY
  using FFmpeg lavfi `testsrc2` and `sine` (MPEG-4 video and AAC audio).
  Its valid MP4 free atom is expanded to exactly 8 MiB + 127 bytes so
  every copy necessarily crosses the immutable 8-MiB chunk boundary.
- Uses the actual private-s3.mjs multipart S3 client talking over HTTP
  to disposable MinIO with server-side encrypted test storage. It saves
  movie parts to PostgreSQL, verifies exact source SHA-256 and then
  independently reads the S3 objects and decodes a video frame and
  audio samples using real FFprobe + FFmpeg, with NO mocked decoder.
- The same full pipeline is also exercised for an episode in its
  distinct PostgreSQL episode runs table and private S3 key namespace.
  The movie and episode each have two independent saved parts, verified
  full-file SHA-256, audio and video decode proof, and read-only history.
- The provider and user playback remain untouched: the test Range
  origin is only in-process generated content, not an Xtream account.
- The owner-app and Android/Windows A/V canary remains an outstanding
  manual validation gate. This CI test validates local S3/DB plus real
  media decoders; it does not validate real Railway S3 nor copy rights.
- All Content Hub licensed pilot CI jobs passed after adding this
  movie-and-episode end-to-end synthetic media smoke on 16 Nov 2026.


## Actual MinIO AES256 at-rest and PostgreSQL lost-ACK + corruption gates

- The enhanced CI exercises a **real** PostgreSQL checkpoint commit
  whose acknowledgement is deliberately lost after an S3 multipart
  object is saved. The worker returns `mirror_checkpoint_commit_uncertain`,
  retains the saved object, resumes directly at the next 8MiB range,
  and independently verifies the complete source byte sequence.
- The same MinIO end-to-end test now makes an actual HeadObject call
  for each movie part and asserts `ServerSideEncryption == AES256`,
  not merely that the SDK requested encryption at upload startup.
- After verifying the isolated episode and decoding its A/V, the test
  deliberately corrupts one S3 object using an out-of-band S3 PutObject.
  A new audio/video canary must reject it before decoding with
  `canary_private_read_failed`, no Xtream request or customer cutover.
- All of the isolated `guarded-mirror`, disposable PostgreSQL and real
  S3/FFmpeg test jobs passed on 16 Nov 2026.
- One separate BLOFY Activation CI browser test failed at subscriber
  UI save rendering on this head; it is unrelated to the modified
  Content Hub fixture and must be investigated before any merge.

None of these tests changes Railway production objects or proves
the license for copying or redistribution of a third-party library.


## Corrupted private S3 manifest quarantine (fail closed)

- Proven per-part S3 SHA-256 mismatch is returned as the dedicated
  `canary_private_sha256_mismatch`, separated from temporary storage
  read/network failure `canary_private_read_failed`.
- After an authenticated owner requests a movie/episode copy canary
  and its S3 bytes fail the persisted part digest, the private Hub
  atomically updates only that `mirror_<32hex>` PostgreSQL run from
  `verified` to `failed` with `mirror_private_sha256_mismatch`.
  It does not delete any S3 object or guess at a new source version.
- A quarantined run is excluded from the existing verified-only movie
  and episode object readers. It is not automatically promoted back to
  verified and must be revalidated/retransferred under new approval.
- Non-hash decode, source, FFmpeg and temporary storage failures do
  NOT quarantine: only independently observed SHA-256 corruption does.
- UI highlights the quarantined result and removes its stale verified
  playability check button. Customers remain on existing routes.
- An actual authenticated/unauthorized HTTP test hits the private Hub
  canary endpoint against real disposable MinIO+PostgreSQL, checks
  exact owner action, verifies 409 and sanitization, and confirms
  the corrupted episode is no longer retrievable as verified.
- Both the BLOFY SOURCES CI and the four PLAYER CI workflows passed
  on 16 Nov 2026 after implementing the quarantine behavior.

All tests use locally generated MPEG4/AAC video. This is NOT permission
to mirror third-party Xtream media, nor an end-device playback test.
