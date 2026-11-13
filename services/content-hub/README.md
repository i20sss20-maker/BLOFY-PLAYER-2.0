# BLOFY CONTENT HUB — private licensed VOD mirror pilot

Status on 2026-11-13: **non-persistent upstream Range probe passed;
persistent file copying NOT enabled.**

## Actual saleh test, Railway production portal

The portal ran exactly TWO sequential read-only HTTP Range samples against
ONE indexed movie in source `saleh`:

| Check | Value |
|---|---|
| Provider response per request | HTTP 206 Partial Content |
| First Range | bytes 0–4095 |
| Second Range | bytes 4096–8191 |
| Source-reported complete size (both requests) | 2,934,023,949 bytes (~2.73 GiB) |
| Body bytes verified from each part | 4,096 bytes |
| Range total stable | Yes |
| Different concurrent upstream streams | 0; all sampling sequential |
| Full video file downloaded | No |
| Full-file checksum or audio/video playback | Not verified |
| Permanent storage rights | Not yet established |
| Customer traffic and existing codes changed | No |

These results demonstrate **sequential byte-range consistency for one
sample**, a useful prerequisite for resumable download. They do NOT
demonstrate all catalog files can be copied, that a complete movie is
available, or that permanent storage is licensed.

The 2026-11-13 catalog index had 56,862 live, 184,758 movie and 50,214
series items marked enabled; those counts are indexed metadata and are not
proof of media availability or rights for every item.

The one-shot Railway probe was disabled after completion:
`BLOFY_SALEH_RANGE_PROBE_ON_BOOT=0`.

## Implemented offline-only building blocks

- `services/activation/src/xtream-content-hub-range-pilot.mjs`:
  owner-approved, bounded read-only two-Range actual source test.
- `services/content-hub/src/mirror-policy.mjs`:
  fail-closed storage rights, source, private bucket, upstream quota,
  per-file size, S3 multipart size and object-key policy.
- `services/content-hub/src/mirror-pilot.mjs`:
  a pure worker with required injected private adapters; it streams a
  single licensed movie/episode via sequential verified Ranges to an
  exclusively private multipart object and requires an independently
  recomputed full SHA-256 and byte count before accepting success.
  Missing validators, range mismatches, changed source, invalid checksum,
  missing adapter or storage license all FAIL CLOSED. The worker may never
  publish a public access URL or reroute subscriber traffic.
- `services/content-hub/test/mirror-pilot.test.mjs`:
  synthetic offline cases for opt-in, secret-free object naming,
  one-source lease, full SHA-256 check, range ignoring, changed ETag,
  storage cleanup and memory bounds.
- `.github/workflows/content-hub-pilot-ci.yml`:
  isolated build/test workflow; no provider calls or persistent uploads.

## Not wired to production

No Content Hub worker service, S3/Railway Bucket, credentials, upload
schedule, distributed lease implementation, source range adapter, or
stored-file playback route is active. There is no auto-import or full
movie copy. This is deliberate: redistribution authorization is not
automatically storage/reproduction authorization.

Production currently has NO bucket in the BLOFY activation project.
The only volumes are service data and Postgres.

Before a live file download, the operator must explicitly verify that
the provider's rights include **permanent copying/storage** of this
specific content, not just live redistribution. A configured private
bucket must be provisioned with costs acknowledged, and these independent
components must be implemented and tested:

1. Private source URL adapter: query one already-licensed mapped item, use
   encrypted provider secrets only server-side, validate each redirect and
   source origin, issue Range without a plain-GET fallback, hard timeout.
2. Durable distributed lock: one origin connection at a time, no parallel
   movie downloads against the provider's reported single-feed capacity.
3. Private S3 multipart adapter: minimum 8-MiB nonfinal chunks, cleanup,
   no public object ACL or CDN link, secret-free keys.
4. Independently verify uploaded object's full SHA-256 by reading private
   storage; a multipart S3 ETag is NOT a content checksum.
5. Store admin-only job progress, error reason, cost and source quota in
   Postgres. Source IDs, passwords, direct URLs and encryption keys never
   appear in UI or logs.
6. Execute an authorized fixture copy, then ONE approved real VOD item;
   independently play the copy with image AND audible audio on target
   devices. Only then consider more workers and a client canary.

**Do not estimate total storage using the first movie as an average.**
Movie/episode sizes can vary enormously, and a full catalog clone may
require very large paid storage. Start with a measured pilot and quotas.

## Required per-job switches (intentionally OFF)

- `BLOFY_CONTENT_HUB_UPLOAD_ENABLED=1` AND
  `BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED=1`.
- `licenseEvidence.storagePermitted=true` plus a scoped permission
  `saleh-vod-persistent-copy` for that job.
- A private, configured bucket and empty exclusive source lease.
- Verified byte size, mapped media ID and private adapters.

**Neither flag is configured in Railway production.**
