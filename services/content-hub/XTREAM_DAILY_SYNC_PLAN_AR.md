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
