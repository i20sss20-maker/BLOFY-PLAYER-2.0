# BLOFY STREAM — backup, reload and capacity verification

## 1. Source-of-truth and rollback policy
The reseller's Xtream account controls upstream category/order. BLOFY imports the
catalog; old customer codes read the same source-scoped gateway tables after
explicit or scheduled synchronization. Do not edit account codes, customer
entitlements or streaming URLs during catalog refresh.

The STREAM operator's **Save publisher customizations** button calls the
existing Studio Pro snapshots API. This is **not a full backup**. Each
snapshot caps category overrides at 2,000 and customized items at 2,000. It
does not contain full Xtream media, customer codes, account secrets, PostgreSQL
globals, or WAL/PITR. A successful snapshot is not proof of disaster recovery.

## 2. Full off-site PostgreSQL backup (not yet enabled)
Optional, gated GitHub Actions workflow:
`.github/workflows/blofy-stream-postgres-backup.yml` (manual dispatch, environment
`blofy-backup`). It needs a dedicated least-privilege READ backup account,
an encrypted private S3 bucket, an AWS KMS key, and secrets:
`BLOFY_BACKUP_DATABASE_URL`, `BLOFY_BACKUP_S3_BUCKET`,
`BLOFY_BACKUP_KMS_KEY_ID`, `BLOFY_BACKUP_AWS_ACCESS_KEY_ID`,
`BLOFY_BACKUP_AWS_SECRET_ACCESS_KEY`, and variable
`BLOFY_BACKUP_AWS_REGION`. Require reviewer approval for that environment,
S3 Block Public Access, KMS key policies, lifecycle/retention policy and
bucket versioning. Never store these values in GitHub source or ChatGPT.

The script streams `pg_dump -Fc` to an SSE-KMS object. Upload/HEAD success
does **not** verify that a restore succeeds. Verify in a SEPARATE empty
PostgreSQL instance. Download object securely, inspect
`pg_restore --list --file=- backup.dump`, restore with
`pg_restore --no-owner --no-acl --dbname="$STAGING_RESTORE_URI" backup.dump`.
Run consistency counts for sources, category rows, item rows, active codes,
source-scoped catalog revisions and all foreign keys. Never restore onto
production as a test. A restore may require matching PostgreSQL major version.
Scheduled backup and Railway volume snapshots are not configured by this PR.

## 3. Automatic Xtream sync
The pre-existing `xtream-studio-pro.mjs` supports source-scoped opt-in
scheduled sync at 6/12/24/48/168h intervals. An internal timer checks due
schedules every 5 minutes, with row locking and bounded queue. New STREAM
operator controls allow explicit enable/disable at 12/24/48/168h. Enabling
does NOT run an immediate sync. For immediate import press "نقل تحديثات Xtream
إلى الأكواد" separately, wait for completed source sync, then compare an old
and new code to the same source. Failed/partial imports must be investigated;
the source protections preserve old catalog data when upstream unexpectedly
returns empty lists.

## 4. Code client refresh
Every successful import advances
`blofy_xtream_catalog_revisions.revision` for that source. A redeemed code
uses `/player_api.php?action=get_blofy_catalog_version&since=N` with its normal
Xtream authentication. Only published, enabled, source-scoped accounts can
check. `changed=true` means the **client should** explicitly reload the
standard Xtream categories and items, clear stale catalog cache only AFTER
a complete successful new load, and retain playback session/device binding.
The backend exposes the action; Android clients are NOT automatically updated
by this deployment. No FCM/push or background device change is implied.

## 5. Live capacity verification (NOT tested)
The unit test `stream-ops-synthetic-concurrency.test.mjs` runs 100 mocked
concurrent catalog-version checks and 100 ordered-query preparations.
**It does not create 100 media connections or prove 100 viewers.** For a
production-worthy concurrency claim:
- obtain permission and upstream max-connections conditions for the actual
  source, and isolate a permitted test stream;
- run staged 10 -> 25 -> 50 -> 100 viewer ramps, with independent media
  decoder clients and bounded test durations;
- record live playback success, 4xx/5xx, provider failures, latency,
  CPU/memory, HLS sessions, relay egress and disconnections, without secrets;
- abort immediately if upstream rights or service health are impacted;
- do not declare 100 viewers supported until measured on real devices
  and no-impairment validation passed.

## 6. Operator checklist
1. Select the published Xtream source; enable auto sync only when source
   resilience and current media catalog are verified.
2. Inspect last sync, code count, catalog revision and source status.
3. Save bounded publisher customizations if <=2k; enable full offsite
   PostgreSQL backup separately.
4. Complete first manual full three-media sync; test one existing and one
   new authorized code, catalog order, actual live and VOD playback.
5. Verify user-initiated app refresh. Never claim that the backend revision
   implies all customer devices have refreshed.
