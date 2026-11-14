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
