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


## 2026-11-15: REAL (but disabled) individually licensed MOVIE transfer worker

The pipeline now has a cross-item dynamic private movie path:

`Xtream mirror discovery -> owner item-level storage rights attestation
 -> verified 4KiB HTTP 206 source size probe -> approved Postgres row
 -> reserved private 8MiB transfer lease -> existing 8MiB chunked movie
 runner -> private S3 verified chunk/checkpoint -> full private SHA256
 manifest -> verified queue row`.

A second exact-item, private-token-protected activation bridge uses
`/internal/blofy-content-hub/mirror/movie/<gatewayId>/describe` and
`/internal/blofy-content-hub/mirror/movie/<gatewayId>/source` rather than
the earlier hard-coded pilot movie. The gateway verifies on every call:
the item is an *active leased* row in state `copying`, the original
individual rights attestation and recent size proof exist, the approved
saleh Xtream source is still enabled, the gateway ID still maps to
the same media ID/extension, the lease has not expired, and the provider
Range response matches the exact pinned file length. Other IDs fail closed.

BLOFY Content Hub now has a cross-replica, persisted daily per-source
**reserved byte budget** and an exact one-file claim. At most ONE
8 MiB chunk is dispatched per two-minute timer tick; the default
ceiling is 64 MiB per Riyadh day (hard cap 512 MiB/day) until
provider connection limits and actual S3 cost have been measured.
An interrupted worker can resume an expired lease under the SAME
private run ID, reusing verified S3/PG checkpoints. A normal checkpoint
returns the queue row to approved; a source/storage failure requires
review. Only the private `getVerifiedChunkedObject` full-file manifest
with exact length + SHA-256 can mark a row `verified`. This never
creates subscriber media routes or deletes verified content.

All flags below must be specifically reviewed by the operator and are
absent/OFF in Railway:

On **blofy-activation-portal**:
- `BLOFY_CONTENT_HUB_BRIDGE_ENABLED=1` (existing private bridge)
- `BLOFY_XTREAM_MIRROR_DYNAMIC_MOVIE_BRIDGE_ENABLED=1`

On **blofy-content-hub**:
- `BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED=1`
- `BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED=1`
  (never set from merely having Xtream credentials; requires actual
  license evidence for each movie).
- `BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID=<exact approved saleh UUID>`
- `BLOFY_CONTENT_HUB_MIRROR_DAILY_BYTES_LIMIT=67108864`
  (64 MiB/day, optional, max 536870912).
- Existing `CHUNKED_ENABLED`, `UPLOAD_ENABLED`,
  `STORAGE_RIGHTS_CONFIRMED`, quiet-window, source-idle and
  private bridge-token flags must also independently pass.

Admin-session monitoring:
`GET /api/v1/admin/content-hub/mirror/movie/status` proxies
the private Hub `/internal/mirror/movie/status` and reports the
last attempt + seven days of bytes reserved. A reserved chunk does NOT
guarantee bytes were copied or that the movie is playable.

**Not production-ready yet**: the rights audit, storage estimate, provider
capacity and real device play/seek/audio test are incomplete. Physical
movie transfer is implemented in the QA code path but **not enabled
or run against the live provider**. Entire-series episode transfer is
still handled by the prior manual season queue, not this movie worker.
The goal of automatic copying of all authorized Xtream content remains
unfinished. No Railway deploy or customer traffic cutover was made.


## 2026-11-15: Licensed EPISODE dynamic transfer joins the movie worker (QA)

An additional opt-in independent **episode** dispatcher now performs:
`approved exact mapped episode + stored per-item rights attestation
 -> current size-probe proof -> exclusive source-scoped PG claim
 -> private /mirror/episode/:id/source Range bridge -> existing
 runOneEpisodeChunk() 8MiB S3 worker -> durable manifest/part SHA-256
 -> independent final private getVerifiedEpisodeObject() SHA+size proof
 -> verified mirror queue row`.

The episode bridge checks the live active lease, exact provider/source
mapping, individual rights attestation, current original media length,
and source health before each Range. A private bearer token is required.
On failure, the item is held as `failed` for operator review, not
automatically retried forever. An expired lease can resume the same
run ID and reuse verified stored S3 chunks.

**Movies and episodes share the SAME Postgres daily byte budget table**.
The default combined budget is 64MiB per Riyadh local day, hard cap 512MiB,
and each worker claims only one 8MiB chunk per two-minute tick during
04:00–05:59 Saudi time. Source lease and in-process busy checks prevent
simultaneous copy loops. There is no subscriber cutover.

Opt-in flags, all **OFF in production**:
- Gateway: `BLOFY_XTREAM_MIRROR_DYNAMIC_EPISODE_BRIDGE_ENABLED=1`,
  plus existing `BLOFY_CONTENT_HUB_BRIDGE_ENABLED=1` and
  `BLOFY_CONTENT_HUB_EPISODE_RANGE_ENABLED=1`.
- Content Hub: `BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED=1`,
  `BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED=1`,
  `BLOFY_CONTENT_HUB_MIRROR_EPISODE_AV_SAMPLE_CONFIRMED=1`,
  `BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID=<approved saleh UUID>`.
  Existing `EPISODE_COPY_ENABLED`, `EPISODE_RIGHTS_CONFIRMED`,
  `UPLOAD_ENABLED`, `STORAGE_RIGHTS_CONFIRMED`,
  `SOURCE_IDLE_CONFIRMED`, `SOURCE_QUIET_WINDOW_CONFIRMED`,
  and shared private bridge token must also pass.
- Admin status:
  `GET /api/v1/admin/content-hub/mirror/episode/status`
  proxies private `/internal/mirror/episode/status`.

These are **only software gates**, not a determination that the Xtream
provider grants permanent media copying. Actual per-file legal rights,
storage cost, source feed limits, real-media stream quality and mobile/TV
playback must be verified by an operator BEFORE enabling source traffic.
The new code has NOT downloaded the user's entire Xtream catalog.
No production deployment and no customer-app changes in this draft.


## 2026-11-15: Multi-day copy reliability and verified PRIVATE playback QA

**Fix:** With the safe initial daily media budget (64MiB/day), a 1GiB
film could take many days. Previously the original media size proof
expired after 48 hours while the size probe only checked
`needs_review` rows, so an `approved`, partially copied item would
eventually stall. The preflight now preferentially reprobes
partially copied, individually authorized and **approved** movies or
episodes before the old size proof expires, once per local day
during the existing quiet window. A changed byte length or
origin-version validator freezes the item for operator review while
preserving all already verified S3 checkpoints. An origin with no
version header is still protected by the existing two-boundary sampled
SHA check per chunk (not equivalent to a signed source version).
No provider request is added outside the specifically opted-in scanner.

**New private owner QA only, default OFF:**
`BLOFY_CONTENT_HUB_MIRROR_OWNER_QA_ENABLED=1` creates a limited
one-connection Postgres mirror QA lookup. After a movie or episode is
`verified` in the mirror candidate queue, the QA function independently
reads the previously verified chunk **manifest record** and compares its
saved length, container and SHA-256 against the queue's final copy proof.
This initial GET is **not a fresh full S3 object rehash**. The POST
canary reads private S3 chunks (including four seek positions) and
decodes audio/video, but does not reread every byte in the file.

Operator session endpoints:
- `GET /api/v1/admin/content-hub/mirror/media-qa/movie/<gatewayId>`
- `GET /api/v1/admin/content-hub/mirror/media-qa/episode/<gatewayId>`
- `POST` to either with the explicit
  `x-blofy-owner-action: verify-private-mirror-playback` header.

Each POST requires a valid owner session, exact approved source and
verified private S3 manifest before it can run. It uses the existing
private ffprobe/ffmpeg A/V decode canary and four authenticated
S3 byte-range seeks (start/middle/cross-chunk/end). GET reports the
last result; QA logs contain no upstream provider URL or credentials.
The backend does **not** contact the Xtream provider during QA,
publish any public media, or re-route subscribers.

A successful canary proves private file-backed A/V decoding and seeking
inside Content Hub. It DOES NOT establish real playback or remote
control behavior on Android phone, Android TV, or Windows clients.
Those devices still require signed debug builds and actual
interactive testing before customer rollout.

**Status:** PR #609 is a draft, not deployed. New metadata scan,
copying and QA flags remain OFF; the code's offline tests are not
evidence that the live Xtream catalog was transferred or played.


## 2026-11-15: private owner-device QA playback ticket (Windows / Android / Android TV)

The separately reviewed owner-device ticket implementation from draft
PR #607 is integrated and expanded here to support **movie AND episode**.
The public-facing *QA-only*, opt-in Range relay is:

- `HEAD/GET /api/v1/private-device-qa/movie/playback/<runId>`
- `HEAD/GET /api/v1/private-device-qa/episode/playback/<runId>`

It requires `Authorization: Bearer <15-minute HMAC ticket>`, never
a token in the URL. The signed ticket binds the exact run ID,
media kind, device-test platform (`windows`, `android`, or
`android_tv`), issue time and 15-minute expiry. A token for a movie
cannot access an episode. Every GET requires an explicit byte range
no larger than **8 MiB**. The activation portal forwards only a
HEAD or bounded Range request to the **SHA-verified private S3-backed
Content Hub**; it never accesses Xtream, a subscriber catalog, or
long-lived provider credentials. It refuses unverified private objects.

To issue one owner-only ticket, the current admin session POSTs to
`/api/v1/admin/content-hub/mirror/device-qa/ticket` with
`x-blofy-owner-action: issue-private-mirror-device-ticket`, and
JSON `{"mediaKind":"episode","gatewayId":401,"platform":"windows",
"rightsConfirmed":true,"ownerDeviceTest":true}`.
This causes a private call to
`/internal/mirror/media-qa/episode/401/device-proof`. It returns an
approved run ID **only if** the exact mirror queue item still has its
previously SHA-verified S3 manifest AND a matching successful private
audio+video+four-seek canary recorded within the last 30 minutes.
An old canary, changed run, mismatched SHA or missing verified storage
cannot mint a ticket.

This flow requires TWO additional, disabled-by-default switches:
- On activation: `BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED=1` and a unique
  32+ character `BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY` not shared
  with any other token.
- On Hub: `BLOFY_CONTENT_HUB_MIRROR_OWNER_QA_ENABLED=1` and working
  private PostgreSQL+S3 manifest verification.

Windows debug consumer is in separate draft PR **#608**; its endpoint
has been changed to the episode-scoped path above. Its application is
NOT a signed customer release, and actual hardware playback/audio
testing has not been performed. Android/TV ticket issuance is supported
at the backend but still requires an isolated debug-only app UI/player
integration and physical device tests.

**No flags are enabled in Railway production, no tokens were minted,
and no external video was made publicly viewable in this QA branch.**


## 2026-11-15: real-worker offline integration and owner mirror status panel

**Integration improvement:** The Content Hub QA suite now exercises the
**actual** `runChunkedMovieBatch()` and `runOneEpisodeChunk()` against
8 MiB **synthetic** HTTP 206 private source responses, with a fake
owner-only provider origin, in-memory private S3 upload/complete/verify,
persisted PG-like chunk snapshots, SHA-256 of the full 8 MiB file,
and normal source lease acquisition/release. It does NOT mock away the
worker: it invokes the real dynamic source path, checks all bytes, and
verifies checkpoint/manifest before marking the mirror queue row
verified. Synthetic bytes are not a playable film; no actual provider
media was fetched. This is an offline regression test, not a production
copy validation.

**New dashboard:** `/admin-content-hub` now has a **read-only** section
"مزامنة مكتبة Xtream والتخزين الخاص", backed only by the existing
authenticated owner APIs. It offers a dropdown of exact-source named
`saleh`, selectable movie or mapped-episode backlog, queue state
filter, cursor pagination and per-row progress (recorded 8 MiB parts).
It also shows index progress, recorded file verification bytes,
gateway remap warnings and the shared daily **reserved** transfer budget
for both kinds. When either automated worker is disabled or data is
unavailable, the page says so instead of pretending files were copied.
No POST, manual transfer, source-video request or customer cutover is
possible from this panel.

The UI correctly warns that the episode map can be incomplete and
that PG-manifest byte totals do not independently measure current S3
physical free space, nor constitute a fresh complete S3 rehash.

**Rollout:** Keep this draft PR unmerged and flags disabled until
individual storage licensing, real provider quota, storage expense,
real content transfer + A/V/seek canary and physical Android TV/Windows
tests have completed.


## 2026-11-15: resumable transient failures and verified Postgres retry policy

**Durable recovery:** A temporary Xtream connection reset, private S3
read problem, lease contention or worker cancellation should not mark
an already downloaded movie/episode permanently failed. Both the real
movie and episode dispatchers now classify only known **transient**
errors as `retry`. The same PG queue row retains its original
`copy_run_id`, `copied_parts` and private SHA-checked S3 chunk
lineage. Under a source-scoped PostgreSQL row lock, the store schedules
a retry after **15 minutes**, with **3 transient failures maximum**
between successful checkpoints. After the third unsuccessful attempt,
the item becomes `failed` and needs a new owner review. Successful
verified chunk progress resets the retry count. The global
8MiB-chunk/day budget still counts attempted source reads, including
failed attempts; it is never refunded speculatively.

Changed source size, source version/boundary, incorrect gateway
mapping, corrupt S3 chunks and missing media licenses are **NOT**
silently retried. They remain blocked pending manual review. A fresh
rights attestation resets only the transient retry count and deadline,
not old stored parts or SHA lineage. Incompatible old parts must be
inspected/reset through a separate audited operator process, not
automatically overwritten.

**Crash after final checkpoint:** The episode worker now recognizes
the case where the last part was SHA-verified and recorded but the
process restarted before full-file finalization. It rereads all
previously stored private S3 chunks, independently verifies each part
and the full-file SHA, commits verified state, and requests **zero new
source bytes**.

**Verification added:** Offline tests exercise both real 8MiB HTTP
Range-to-private-S3 workers, the last-chunk crash/restart case, and
transient/permanent error classification. A separate disposable
PostgreSQL 16 CI test exercises actual shared movie/episode source-day
budget transactions, row locks, preserved run IDs, delayed retries
and the three-attempt terminal state. No provider credentials or
production resources are used in these tests.

**Still draft:** Production feature flags remain disabled, all
new files must have individually reviewed storage permission,
and actual source/network and device playback performance remain
unverified.


## 2026-11-15: Pre-deployment safety check for two Railway PostgreSQL services

**Important blocker addressed:** an activation service and a Content
Hub service can BOTH have a `DATABASE_URL` while pointing to
DIFFERENT PostgreSQL databases. The dynamic mirror copy claims source
metadata, rights-review rows, episode gateway mappings and S3 manifests
under a single atomic source-scoped transaction. Before deploying or
enabling ANY media worker, the owner must prove these tables are
visible from the actual **Content Hub** connection; a healthy Railway
service alone cannot establish this.

A new authenticated, **read-only** technical diagnostic (zero DDL,
zero provider requests, zero copy) is now implemented:
- Content Hub: `GET /internal/mirror/deployment/preflight` using the
  existing private Hub bearer token.
- Activation owner-session proxy:
  `GET /api/v1/admin/content-hub/mirror/deployment/preflight`.
- The `مزامنة مكتبة Xtream` dashboard shows a prominent warning when
  the approved `saleh` source ID differs, the source is offline or
  stale, any Xtream map/queue table is absent in the Hub PostgreSQL
  connection, the private movie/episode manifest tables are missing,
  the shared source/day byte budget is absent, or private S3 health
  cannot be confirmed.

The result distinguishes `technicalPreflightPassed` from
`perFileStorageRightsIndependentlyVerified` (always false in this
schema-only diagnostic). Even a fully green technical check **does
not authorize a download**, does not validate a provider's permanent
storage license or concurrency limit and **never turns any flag ON**.

An isolated real PostgreSQL integration test verifies that the
diagnostic initially fails when manifest/budget tables are absent,
then passes once the same database schema contains all technical
tables. A missing table is not interpreted as zero copied files.
There is no automatic database migration between services and no
storage of database passwords or other credentials in the response.

**Additional bug fixed:** operator POST to
`/api/v1/admin/content-hub/mirror/media-qa/<kind>/<gatewayId>`
previously forwarded the Content Hub's asynchronous **202 Accepted**
but then rejected its JSON body with a strict 200-only decoder,
making an accepted QA appear failed. The owner proxy now explicitly
preserves 200, 202, 400, 403 and 409 JSON statuses using a bounded,
allow-listed response decoder. All other private-read callers
remain 200-only by default. A new test checks this exact behavior.

**Status:** This functionality remains only in unmerged draft
PR #609, and no Railway production environment variables or customer
streams have been changed. Actual DB affinity cannot be declared
verified before the diagnostic runs on the eventual deployed build.


## 2026-11-15: Exact source and episode-parent identity protection

**Prevent accidental cross-source copying:** A source may have a gateway
item with the same numeric ID as another Xtream source. Previously the
private dynamic movie/episode Range bridge queried active leases by
gateway ID only. It now requires the exact
`BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID` UUID on the **activation
portal** as well as Content Hub. SQL checks
`q.source_id=$2::uuid` against the operator-pinned source on every
dynamic private describe/Range request. Without a pinned source, or
when source UUIDs differ, the bridge **fails closed**. All provider
tokens remain server-side and no catalog route is exposed to customers.

**Prevent episode parent remap:** An episode's storage license is tied
to its original source-episode ID AND its original parent
`series_media_id`. The discovery upsert now uses PostgreSQL
`IS DISTINCT FROM` to flag a changed series parent as a permanent
`mapping_conflict` even when the episode ID, gateway ID and
extension all remain unchanged. It never silently replaces a reviewed
series ID. The per-item rights attestation, 4KiB size probe,
source bridge, and Hub leased-copy claim now each check
`e.series_source_id=q.series_media_id`. Candidates without an exact,
bounded, valid series parent are rejected rather than truncated.

The offline integration coverage includes a disposable PostgreSQL
source-parent remap: a previously approved episode cannot be leased
after a source-side parent change, and a new metadata scan records the
conflict for manual review. Tests also check that private bridges
cannot query an unpinned or invalid source.

These safeguards are software identity checks only: not proof of
storage rights, source quality or actual device playback. This branch
is still unmerged, and **no Railway deployment or automatic copying
is authorized** by this change.


## 2026-11-15: Trust-boundary verification across queue, PG manifest and S3 paths

The private owner A/V and Android TV/Windows device QA gate now
checks more than a saved SHA-256 and length:

- The licensed, `verified` Xtream queue row must contain the exact
  source UUID, media kind, gateway ID, media ID, file extension,
  reviewed rights evidence, bytes and full-file SHA-256.
- The **independent** private PG movie or episode manifest must
  describe the **same** source UUID, media kind, media ID and
  gateway ID in addition to exact bytes, extension and SHA.
- All verified chunk S3 keys must live under
  `saleh/movie/<matching-source-UUID>/` or
  `saleh/episode/<matching-source-UUID>/` as appropriate. A
  cross-source chunk key cannot be used to authorize owner QA even
  if its stored digest is identical.

New tests cover cross-source movie substitutions, wrong gateway/media
ID, missing PG provenance, wrong-kind manifests, and S3 chunk paths
whose source UUID does not agree with the verified manifest. Both
movie and episode metadata-only retrievals remain private, and
a failed comparison denies A/V canary and device-ticket issuance
before any provider request. Existing verified-file metadata is only
a previous integrity proof; a fresh full S3 rehash and physical
playback are separate release gates.

The change is in isolated draft PR #609. No Railway configuration
changes, source copying or customer update was performed.


## 2026-11-15: Private device-playback pilot shadowing guard

The Content Hub historically used the private
`/internal/pilot/playback/<runId>` route for a single verified
legacy pilot movie, and subsequently also for a verified chunked
private mirror. If a legacy pilot object was present with the SAME
`mirror_<40-hex>` run ID, pilot lookup previously took precedence
over the reviewed mirror manifest. A legitimate owner HMAC ticket
for the reviewed mirror could therefore resolve to a different
legacy pilot object.

Now mirror-prefixed run IDs are handled **exclusively** by
`lease.getVerifiedChunkedObject(runId)` and NEVER fall back to
`getVerifiedPilotObject`. An absent/unverified chunked mirror
returns a private 404. Non-mirror run IDs retain the original
legacy pilot behavior. The 8MiB explicit range limit, bearer
authentication and zero public subscriber routes remain unchanged.

An HTTP regression test deliberately returns a legacy pilot
manifest and an independent mirror manifest under the SAME run ID:
the valid movie GET must serve only bytes from the reviewed
mirror chunk. Another test checks 404 when that chunked
manifest is missing, and one preserves legacy playback for
ordinary non-mirror pilot run IDs.

This is isolated QA branch code; not deployed on customer Railway
and not evidence of physical Android TV/Windows playback.


## 2026-11-15: Final QA caveat — Android native FFmpeg ABI gate

The FFmpeg Native GitHub workflow has intermittently rejected its
generated AAR because `jni/x86_64/libffmpegJNI.so` was **not detected
as an ELF64 binary**, even though arm64-v8a passed and the Gradle
native module itself reported a successful build. This is a
release-blocking native ABI check, **not** proof that FFmpeg audio
decoding on the customer's Android TV has been repaired.

The QA build script now prints, for each required 64-bit JNI ABI,
the generated file's native `file` architecture, ELF
`Class`/`Machine`/`Type` headers and SHA-256 **before** rejecting
an invalid output. The ELF64 and >=16KiB LOAD-alignment requirements
have NOT been weakened or bypassed. Diagnostic output is needed to
identify whether x86_64 compilation or artifact packaging is wrong;
do not publish a signed app or silently exclude x86_64 to make CI
appear green.

The owner-only backend manifest provenance checks in this PR now
compare exact Xtream source/media/gateway identity and S3 object
namespace before any private A/V canary or device-ticket issuance.
A separate fix prevents a legacy pilot row from taking priority
over a reviewed mirror movie sharing the same internal run ID.
These checks remain isolated, with zero production media copying.
