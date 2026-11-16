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
