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
