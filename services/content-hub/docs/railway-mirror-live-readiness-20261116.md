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
