# BLOFY / Xtream: daily source sync and private licensed media mirroring

Status: **draft QA implementation**. Nothing in this branch is deployed to customers.
No automatic upload, bulk copy, public playback, provider logins or restreaming
changes are enabled by this proposal.

## What the owner wants

Keep an up-to-date copy of the approved Xtream source's *entire catalog* in
BLOFY and progressively save every VOD item covered by a specific persistent
storage license in the private Content Hub bucket. Detect additions/updates
each day and avoid re-downloading already-verified private objects.

These are two different processes:

1. **Daily catalog** (movies, series, channels, categories). Existing
   `xtream-admin-hook.mjs` has the working ingestion engine and database tables.
   This branch adds an exact-source, owner-only daily dispatch at **04:00
   Asia/Riyadh** with a cross-replica Postgres unique claim.
2. **Physical media copies** (movies and individual episodes only). New
   `xtream-daily-copy-plan.mjs` is an offline **DRY RUN** that proposes only
   individually licensed, size-probed, source-pinned items that fit a tight
   file and byte budget. It does not call the source or start a worker.
   Existing Content Hub manual operators still govern actual transfers.

## Optional flags — OFF until operator authorizes source-impacting refresh

Activation portal only:
- `BLOFY_XTREAM_DAILY_CATALOG_SYNC_ENABLED=1`
- `BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID=<exact approved saleh source UUID>`

A configured source must be enabled and be called exactly `saleh`.
Every 5 minutes inside the 04:00–04:59 Riyadh hour the portal checks
whether this source has been requested that day. The first eligible
instance inserts a Postgres daily claim and enqueues the existing Xtream
catalog sync; duplicates do not enqueue another sync. The scheduler never
downloads movie or episode bytes, never records channels and never changes
customer player routing. On enqueue error it releases the claim.
Existing catalog guardrails preserve prior metadata when source APIs
return anomalous empty results.

The daily claim denotes **queued/attempted**, not **successfully
completed**. Track `last_sync_at`, `last_error` and per-type counts from
the existing Xtream admin interface before declaring a successful day.

## What remains before continuous complete VOD mirroring

- Verify provider's actual individual-item permanent storage/redistribution
  grants, current connection quota, source fair-use terms, and which files
  permit recording. Xtream credentials and `isRestreamer` alone do NOT grant
  copying rights.
- Size-scan eligible movies and *enumerate* series episodes via
  `get_series_info`; a series catalog record is not itself a media file.
- Estimate total bytes, recurring storage bill, egress, ingestion duration and
  available per-day private bucket space. Current private workers are bounded
  to 4 GiB per file and their 8 MiB chunks; large movies require a new
  separately tested transfer implementation.
- Persist a durable incremental media snapshot/copy queue, and connect
  approved rows from the daily plan to the existing private chunk worker
  with exactly one provider connection, measured quiet window, retries,
  resumable checkpoints and independent SHA-256 readback.
- Treat removed upstream items as **review**, not automatic deletion of
  verified private storage; revalidate changed source versions.
- Test private playback with actual client video, audible audio and seek
  before routing even one customer to a verified copy.
- Live channels are **streams**, not finite files. Daily sync updates their
  catalog; a 24/7 live recording/archive needs an independently licensed
  recorder, retention policy and significant ongoing storage/bandwidth
  capacity. This branch deliberately does not create one.

Existing Content Hub upload and queue flags remain OFF; do not turn them
all on as a substitute for missing authorization, capacity or testing.


## Additional implemented QA controls (2026-11-14)

The admin-session-protected activation API can inspect the imported source
without fetching media:
- `GET /api/v1/admin/xtream/mirror/inventory?sourceId=<UUID>&mediaType=movie&pageSize=50`
- mediaType can be `live`, `movie`, `series`, or `episode`; the episode
  view is only the gateway's **previously mapped** episode subset, never
  guaranteed full provider `get_series_info` coverage.
- Query uses a source-scoped keyset cursor. No Xtream URL, password, token,
  private S3 key or source media bytes is returned.
- `GET /api/v1/admin/xtream/daily-sync/receipts?sourceId=<UUID>` shows
  recent `queued`, `completed`, `partial` or `failed` daily metadata
  import receipts. `partial` is not full synchronization success.

An additional Content Hub private bearer-protected API exposes
`POST /internal/mirror/daily/plan`, requiring the explicit operator header
`x-blofy-owner-action: preview-licensed-daily-mirror` AND the opt-in
`BLOFY_CONTENT_HUB_DAILY_MIRROR_PLANNER_ENABLED=1`.
It accepts up to 25 individually licensed items and proposes up to 12
files / 8 GiB in one dry-run. It **never** contacts Xtream or writes
storage; it rejects client claims of pre-verified S3 objects. It does
not independently measure a provider's current stream-count or legal
grant. An actual production worker must recheck both.

All flags remain OFF in Railway. The remaining full physical-copy implementation
requires an independently licensed and budgeted durable media queue,
provider metadata enumeration, tested general movie/episode workers, media
size and version probes, and a post-copy private playback test.


## Latest QA implementation: daily REAL private chunk-copy session (still OFF)

The Content Hub runtime can now **launch** the existing S3 copy workers
inside the 04:00–04:59 Asia/Riyadh window. This is a meaningful next
step beyond the previous dry-run planner, but the scope is intentionally
small and opt-in.

Config on `blofy-content-hub`, all initially absent or OFF:
- `BLOFY_CONTENT_HUB_DAILY_COPY_ENABLED=1`
- `BLOFY_CONTENT_HUB_DAILY_COPY_MODE=movie` **OR** `episodes`
- The ordinary per-media rights, operator-approved fixed gateway,
  read-only size probe, private storage, bridge, source-idle and
  quiet-window flags still must independently pass.

**movie mode** launches only the single already-approved movie described
by `BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID` and
`BLOFY_CONTENT_HUB_BATCH_RUN_ID`. The existing chunked worker downloads
up to 8 MiB per source read, records PG/S3 checkpoints and independently
verifies the full SHA-256 at completion. Its session is bounded to up to
400 chunks and 40 minutes; unfinished verified chunks remain reusable.

**episodes mode** launches only already-selected and approved rows in
the durable season queue, not every Xtream series. It additionally
requires the independently recorded owner confirmation of visible
video / audible audio on a verified sample and zero unresolved
storage-integrity issues. At most 60 chunk operations are launched
per day, each with the existing 8 MiB per-chunk limit.

The daily launcher stores a unique `(saleh,local_day)` Postgres claim
before starting, so another replica/restart cannot double-start the
same day's copying. A refused start releases the claim. The claim proves
a session was STARTED, **not** that a movie or episode completed or
that S3 bytes were verified.

Endpoints, accessible only via operator auth:
- Hub `GET /internal/mirror/daily/sessions` — last seven starts.
- Portal `GET /api/v1/admin/content-hub/mirror/daily/sessions` — same,
  only through the existing signed owner session.
- Portal `POST /api/v1/admin/content-hub/mirror/daily/plan` — dry-run,
  owner marker required.
- Portal `GET /api/v1/admin/xtream/mirror/coverage?sourceId=<UUID>` —
  *catalog items vs verified manifest rows*; no provider network calls.

**The full requested automatic copy of every licensed Xtream movie and
episode is NOT implemented.** Still missing: safe enumeration of every
series episode, durable source-scoped cross-item copy queue,
independent item-level license evidence, dynamic source bridge mapping,
oversized-file support, realistic source concurrency monitoring,
storage budget and full device playback tests. Live channel metadata
can sync daily; permanent recording of live streams is not enabled.

The branch is a draft PR, not connected to live Railway deployments,
so even the restricted daily worker will not run until a separate
reviewed deployment explicitly opts it in.


## 2026-11-14: durable full-index mirror discovery queue (QA, OFF)

A new PostgreSQL-backed index `blofy_xtream_mirror_items` stores
source-scoped *movie* and *gateway-mapped episode* candidates. Each
candidate defaults to `needs_review`. The queue stores only catalog
metadata; it does **not** falsely infer an individual perpetual copy
license, exact file size, private S3 verification, source connection quota,
or success of transfer.

`blofy_xtream_mirror_discovery` persists the last gateway ID separately
for movies/episodes with a row lock to prevent simultaneous workers from
duplicating cursor advances. Each scan processes up to 250 records,
continues across container restarts, and revisits a completed catalog
on a subsequent local Riyadh day. If a gateway ID now points to a
different media ID or extension, `mapping_conflict=true` is retained
without overwriting the original approved identity.

Enable only on the operator portal (currently NOT enabled):
- `BLOFY_XTREAM_MIRROR_DISCOVERY_ENABLED=1`
- `BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID=<exact approved saleh UUID>`

At most one 250-movie + one 250-mapped-episode metadata page is scanned
per minute per worker instance, and a shared PostgreSQL row lock ensures
a source/type cursor is advanced safely across multiple replicas.
Scanning only runs while the source has an *online*, complete
(`last_error IS NULL`) metadata sync within the last 48 hours.
This reads existing DB rows only and never connects to Xtream.

Admin-session routes (not public):
- `GET /api/v1/admin/xtream/mirror/queue/status?sourceId=<UUID>`
  grouped candidate counts and persisted scan cursors.
- `GET /api/v1/admin/xtream/mirror/queue/items?sourceId=<UUID>&mediaKind=movie&state=needs_review&limit=50`
  cursor-paged individual candidates and source remap warnings.
- `POST /api/v1/admin/xtream/mirror/queue/discover` with
  `x-blofy-owner-action: discover-private-mirror-metadata` and JSON
  `{"sourceId":"<UUID>","mediaKind":"movie","limit":100}`
  to advance one bounded scan page when the flag is enabled.

**Limitations:** the episode map is only the already-discovered subset
of `get_series_info`; it is NOT exhaustive for all series. Entire-source
episode enumeration and approved-file download dispatch are separate
future stages. No file is uploaded because of a discovery queue row,
and there is no production deployment or scheduled production run in
this draft PR.


## 2026-11-14: per-series enumeration + one-file rights review and exact range preflight

**New feature, OFF by default:** previously unmapped Xtream TV-series
episodes can now be discovered by calling the existing official
`get_series_info` metadata handler, which persists the series' episode
gateway map. The scanner is serialized across Railway replicas using a
session PostgreSQL advisory lock, persists the last indexed series, and
handles multi-day scans without restarting at the beginning. A failed
provider call preserves the cursor for the next permitted run. It
requests at most one series metadata response per 90-second timer tick
inside **04:00–05:59 Asia/Riyadh**, not during peak hours.

Activation/gateway opt-in:
- `BLOFY_XTREAM_MIRROR_SERIES_ENUM_ENABLED=1`
- `BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID=<approved saleh UUID>`

The admin route `GET /api/v1/admin/xtream/mirror/series-status?sourceId=<UUID>`
shows current source-scoped series progress.

Individual storage grants: a separate authenticated operator-only
`POST /api/v1/admin/xtream/mirror/rights-review` requires:
- `BLOFY_XTREAM_MIRROR_RIGHTS_REVIEW_ENABLED=1`
- Header `x-blofy-owner-action: review-one-mirror-storage-right`
- JSON with exact `sourceId`, `mediaKind` (`movie` / `episode`),
  `gatewayId`, `mediaId`, `extension`, an owner's *individual*
  `evidenceReference`, `storagePermitted:true`,
  `persistentStorageScope:"saleh-vod-persistent-copy"`,
  and `operatorReviewed:true`.

This is a **record of an owner's claim**, not an independent legal
verification. Only the SHA-256 digest of evidence reference is saved.
The update checks source status, exact gateway identity and that the
candidate was not remapped. It cannot approve or copy a file on its
own; the item remains `needs_review` until a provider size probe.

Size preflight: `BLOFY_XTREAM_MIRROR_SIZE_PROBE_ENABLED=1` enables
one 4KiB `Range` request for a separately reviewed, exact-mapped
item, at most once per candidate per Riyadh day, during
04:00–05:59. HTTP 206, total size (8 MiB–4 GiB), exact range and
body length are checked. The current source and media gateway
mapping are checked again when recording the size proof in Postgres.
Changed mappings are held for review. Only a valid probe moves the
candidate to `approved` (eligible for a FUTURE independently scoped
private transfer job). **Approved does not mean copied, legally
audited, or playable.** Existing private chunk workers still must
verify complete S3 objects and source stability.

Still **not implemented**:
- Scheduling transfers from each newly approved row using its own
  source gateway scope, avoiding interference with customer playback.
- Source/provider concurrency, real cloud storage budget and rights
  audit for every movie/episode.
- Actual production switch-on, migration rollout and on-device tests.

No bulk request for every series is sent at once, no media files are
stored by metadata enumeration/size probing, and no customer routes
are changed. The entire feature remains under draft PR #609.
