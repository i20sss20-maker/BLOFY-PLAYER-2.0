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

### Updated infrastructure status (2026-11-13)

The owner confirmed that the provider's permission includes persistent
storage and redistribution. BLOFY has now provisioned:

- Private Railway object storage bucket `blofy-content-hub-private`, AMS.
- Dedicated private-only Railway service `blofy-content-hub`, Node 22,
  same AMS region, one replica, /health, PostgreSQL-backed lease adapter.
- Service uses Railway bucket variable references; no S3 credentials stored
  in GitHub. No public HTTP domain was added.
- A private S3 multipart write + independent SHA-256 read-back + DELETE
  of **8,388,608 synthetic bytes** completed successfully; live proof
  `private_s3_roundtrip_verified`, `fixtureRemoved=true`, providerRequests=0.
- Private portal endpoint for one exact mapped saleh movie, constrained
  to max 8 MiB Range, time-bounded, bearer-protected and single-request
  admission. The operator credential is separate from subscriber passwords.
- A second optional real-source-to-private-S3 8MiB sample is implemented
  behind both `BLOFY_CONTENT_HUB_REAL_SAMPLE_ON_BOOT` and
  `BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED`. It has not been
  activated; no live source-to-bucket transfer has been claimed.

There is still **no automatic customer playback cutover, no completed real
movie upload and no public media store**. The full mirror worker has
isolated policy, lease and S3 adapter code but is not connected to an
operator production job queue. High-load and multi-channel capacity
remains unproven.

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

**`BLOFY_CONTENT_HUB_UPLOAD_ENABLED=0` remains enforced in Railway.
The separate persistent-storage permission flag reflects the owner's
confirmation; it does not activate uploading automatically.**


## One-film operator runner (proposed, NOT production-enabled)

The isolated one-film pilot adds `one-movie-pilot.mjs` and an opt-in
startup hook. No movie has been copied as part of this change; until an
authorized operator chooses a **quiet window**, the existing live sources
and consumer playback routes remain unchanged.

To run **one exact approved movie only**, all the following must be
configured on the private `blofy-content-hub` service:

- `BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT=1`
- `BLOFY_CONTENT_HUB_UPLOAD_ENABLED=1`
- `BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED=1`
- `BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED=1`
- `BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED=1`
- `BLOFY_CONTENT_HUB_PILOT_RUN_ID`: a unique 8–80 character run identifier.
  Re-using a run ID will **not** download again, even after restarts.
- `BLOFY_CONTENT_HUB_EXPECTED_BYTES`: exact file size from the earlier
  consistent HTTP Range probe for the same approved movie. The pilot
  rejects unexpected sizes. The prior 2026-11-13 test observed
  `2934023949` bytes, but the operator must reconfirm the same mapping.
- `BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID`: **mandatory** numeric ID of
  that single movie, confirmed to match the private bridge's mapping.
- The existing private bridge credentials and bucket must remain wired.

All these switches default to **off**. The run refuses media redirects,
full-GET fallbacks, missing source-version validators, source size changes,
unverified file hashes, shared/public object access and files above 4 GiB.
The source lease prevents concurrent hub writers but cannot block unrelated
player sessions elsewhere. The quiet/idle confirmations must reflect actual
operator observation; do **not** blindly set them while channels are playing.

An attempt is claimed durably in PostgreSQL before contacting the source.
A failed run requires a new explicit run ID after diagnosis; it does not
retry endlessly. Inspect the private status or the sanitized
`BLOFY_CONTENT_HUB_ONE_MOVIE_RESULT` log. A success means the object
bytes and SHA-256 were independently verified in private storage. It does
**not** yet mean image/audio playback was tested from a BLOFY client.
A separate canary playback route and real-device video/audio verification
are required before switching any customer to the stored copy.

This isolated change intentionally adds **no** public media endpoint,
automatic downloads, bulk sync or customer playback cutover.


### Durable pilot progress + private playback canary (code ready)

The pilot now records `started / verified / failed` and cumulative
`bytes_copied`, `expected_bytes`, and `parts_copied` in PostgreSQL.
A unique versioned S3 key is generated per run to prevent overwriting
the previous verified file. A successful private S3 object is registered
with its independently verified SHA-256; if final registration fails, the
new object is deleted rather than presented as available.

The existing **bearer-protected private-only** `GET /internal/status`
reports `durablePilot` progress for the configured run. The
`GET /internal/pilot/playback/:runId` endpoint serves only a *verified*
private movie, requires the separate operator Bearer token and a strict
HTTP Range of at most 8 MiB, and never publishes a public URL.

These are operator canary endpoints, not subscriber APIs. The private
service has no public domain. Actual client audiovisual verification and
customer rollout have **not** been performed. Before allowing public
customers to use it, add a separate signed, scoped device playback proxy
that hides private object keys and verify image and audio on supported
devices. Stop immediately if source streaming quality degrades.


### Admin dashboard (portal code ready; portal deployment independent)

New admin-only page: `/admin/content-hub`, reachable only through the
existing signed admin session. It reports durable pilot copy progress,
failed/completed counts, and *accounted verified* private storage size.
It can request cancellation of an active pilot and proxy verified-only
8-MiB video byte ranges through the private Content Hub for an operator
image/audio canary. It does **not** enable a subscriber media route.

This integration requires the activation portal service variable
`BLOFY_CONTENT_HUB_OPERATOR_TOKEN` to reference the Content Hub's existing
`BLOFY_CONTENT_HUB_ADMIN_TOKEN` (do not copy a plaintext token to GitHub).
No public Content Hub domain should be configured. The source bridge token
and these operator tokens are independent. The private site proxy never
returns credentials or private S3 object keys to the browser.

Keep `ONE_MOVIE_ON_BOOT=0` until a movie/source is explicitly approved,
quiet/no-subscriber-impact can be confirmed, and operator checks all size,
format, storage cost, and source rights. The admin video canary reports
transport success, **not proof of audible audio/image**, which must be
observed manually on real devices. Browsers may not support MKV/AVI audio;
that is a format limitation, not evidence the stored file is damaged.

Production Content Hub and its database are separate from subscriber
playback. Deploy the portal admin UI only after regression testing and
under an approved low-risk rollout so established live channels are not
disrupted. Before the first real copy, verify the provider exposes a
stable ETag or Last-Modified validator for each Range; otherwise the
worker intentionally rejects the transfer.


## 2026-11-14: private episode proof and season queue (draft / not deployed)

The actual one-episode pilot finished with 173/173 verified private chunks,
1,444,843,431 complete bytes and independent file checksum verification.
A server-side preview diagnostic verified video and audio decoding and four
seek positions without contacting the upstream provider. This is NOT
the same as owner confirmation of audible audio and visible video on a
browser or device. Subscriber traffic was not rerouted.

The new season queue is isolated in the branch
feature/blofy-content-hub-season-queue-20261114 and remains NOT deployed.
It adds a separate operator-only administration panel within the
existing /admin/content-hub page, with season/episode progress,
list/candidate selection, size probes, queue enqueue and pause/resume
controls. The browser also offers a protected short MP4 episode preview.
No private bucket URL, backend credentials or subscriber playback path is
exposed.

### Required protection and scope

- The new BLOFY_CONTENT_HUB_SEASON_QUEUE_ENABLED defaults to OFF.
- The dedicated BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED, upload enabled,
  permanent-copy rights, episode rights, source idle and source quiet-window
  declarations, and a valid private bridge token must all independently
  be configured. Changing these flags does not itself trigger a download.
- Each episode must match the current read-only, limited authorized
  saleh candidate list (at most 12 entries per enqueue), be selected
  by an authenticated operator with storage rights, and have an exact
  source size independently measured with the 4-KiB probe. The season
  identifier is an operator-assigned label: the limited source catalog
  does not yet establish authoritative series/season relations.
- POST /internal/seasons/enqueue only schedules the selected items,
  no media transfer. A second explicit POST /internal/seasons/start
  is required to begin copying in strictly sequential 8-MiB chunks.
  The worker uses PostgreSQL durable episode part manifests, SHA-256
  verification, and the single-source advisory lock. Global scheduler
  advisory locking prevents multiple concurrent queue loops.
- An operator may call POST /internal/seasons/pause at any time.
  Confirmed S3 chunks are kept, and the next explicit approved start
  resumes from verified checkpoints. A transient error retries at most
  twice, with a bounded delay; other errors stop for review.
- During one approved copy session, the queue automatically moves to
  the next chunk and selected episode. It does not automatically
  restart after a container restart: the quiet/idle source assumption
  must be reconfirmed by the operator. This is intentional.
- Default safety conditions are private-only, no public storage/URL,
  no redirect of customer playback, one app replica at a time, and
  no automatic startup. Keep the flag OFF until the preview is tested
  by the owner and real source quota/storage cost are reviewed.

Internal bearer-protected endpoints:
GET /internal/seasons/queue,
POST /internal/seasons/enqueue,
POST /internal/seasons/start,
POST /internal/seasons/pause.
The existing activation portal proxies these through its signed admin
session at /api/v1/admin/content-hub/seasons/*. All POSTs require
an additional exact owner action marker and protected internal headers.
No direct public Content Hub hostname is to be added.

Do not merge the draft PR or switch the Railway live branch solely
because unit tests pass. First verify owner-browser episode audio/video,
review the one-replica/source idle conditions, and then release with all
new queue flags still OFF before a separate, monitored opt-in.


### 2026-11-14 — true series/season discovery and source bridge (follow-up)

The original eight-candidate pilot is no longer sufficient for season copying.
The operator now has a read-only list of indexed licensed series, a direct
series gateway-ID lookup, and a season picker fed by the original provider's
get_series_info metadata as normalized to BLOFY gateway episode IDs.
It can show the exact episode and season numbers and bound one queue
submission to 12 operator-selected, size-probed episodes. More episodes in
a season can be submitted as subsequent batches. The source list is
restricted to active, published, unique saleh mappings.

**Additional activation portal guard:** the new
BLOFY_CONTENT_HUB_SEASON_QUEUE_BRIDGE_ENABLED variable must be 1 to allow
source ranges for episodes other than the original exact one-episode pilot.
The bridge does not grant access based on a user-supplied ID alone: it
requires a recent (less than 3 minutes) currently RUNNING private queue
row, exactly matching source UUID, episode media ID, extension, gateway ID,
live mapped series, enabled saleh source and storage-size constraints.
The copy worker receives only the previously selected metadata pinned to
its durable queue job. The original single-episode permit remains supported
without broadening it, and probes read only 4KiB when an operator requests
them. If the queue table is missing or PG is down, the bridge fails closed.

**Rollout:** Do not infer that a functioning browser episode proves
concurrent channel capacity or confirms that each season item may legally
be retained. The owner must explicitly confirm audible audio plus visible
picture in the admin page, and confirm source idle/quota and rights on
each queue start. Browser sign-off is a prerequisite for queue start, not
a replacement for those checks. Before bulk copying, verify one new
episode from an operator-selected mapped series. All subscriber playback
stays routed as before and no mass copy starts automatically.
