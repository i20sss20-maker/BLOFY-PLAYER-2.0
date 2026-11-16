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
