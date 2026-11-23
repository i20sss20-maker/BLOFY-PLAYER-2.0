# BLOFY STREAM — production continuity / off-site disaster recovery

**Status (2026-11-23): contingency tooling staged in a separate GitHub QA branch; NOT a completed backup or deployed failover. No source routing, customer accounts, subscription codes, payment credentials or live database data were modified.**

## Current production inventory (read-only Railway inspection)

| Component | Replicas | Durable backing | Current continuity limitation |
| --- | --- | --- | --- |
| blofy-activation-portal | 2 | shared PostgreSQL connection | 2 API replicas are not a replacement for the single DB |
| Postgres | 1 | 5 GB persistent volume, AMS | single live DB / region |
| blofy-update-distribution | 1 | 5 GB persistent volume, AMS | downloaded artifacts on one volume |
| blofy-restream-engine | 1 | image-based, AMS | one independent engine; client dependencies not established |
| blofy-content-hub | 1 | private object storage and APIs | needs independently tested object recovery |
| blofy-signed-apk-edge | 2 | bucket `blofy-signed-apk-production`, AMS | object storage also needs versioning and geographic DR |
| blofy-ai-gateway | 1 | no volume | non-critical feature should not block streaming |

Other Railway buckets include `blofy-content-hub-private` and `blofy-mirror-s3-isolated-qa`. These are **not** verified off-site production backups. No external failover region or authenticated secondary source was confirmed.

## Existing status

`.github/workflows/blofy-stream-postgres-backup.yml` was manual only and calls `services/activation/scripts/backup-to-s3.sh`. This repository **does not establish** that the GitHub Actions environment secrets and off-site AWS target are configured or that a successful production database dump has ever been saved.

The new script requires `DATABASE_URL`, `BLOFY_BACKUP_S3_BUCKET`, `BLOFY_BACKUP_KMS_KEY_ID`, `AWS_REGION`, AWS credentials, network reachability and a trusted runner. It fails closed when any required variable is absent; no credentials or production records should appear in logs or CI artifacts.

## Backup architecture to activate, in this order

1. Establish a separate AWS account (or trusted independent provider) and a **private dedicated S3 bucket in a different region/provider failure domain**. Block public access and enforce TLS, SSE-KMS with a dedicated CMK, restrictive bucket/IAM/KMS policies. Enable versioning, object-lock retention if available, and budget alarms. Never share admin payment credentials with this backup role.
2. Use a restricted backup runner able to connect securely to Postgres; *do not publish Postgres publicly solely to make GitHub-hosted runners reach it*. A private runner in the network or approved encrypted private tunnel is preferable.
3. Configure least-privilege read-only database backup role; grant only the database read permissions necessary for a consistent logical snapshot, with schema and large objects included. PostgreSQL backup account requirements must be tested against the actual schema.
4. Run the hardened `services/activation/scripts/backup-to-s3.sh` with secrets supplied through an encrypted runner environment; it creates a custom-format consistent dump, checks its TOC, uploads privately using AWS KMS encryption and verifies object length, encryption mode and SHA-256 metadata. Never upload customer dumps as public GitHub artifacts.
5. Independently download and verify using `services/activation/scripts/verify-s3-backup.sh`. This checks SHA-256 after download and `pg_restore --list`; this alone is NOT a complete restore proof.
6. Restore a copy into a completely separate disposable PostgreSQL instance **after verifying target database name, project, hostname and environment are not production**. Validate counts and sampled non-sensitive functional invariants (code status, expirations, subscriptions, invoices), application schema migrations and API boot, without exposing subscriber data.
7. Only after this proof enable a scheduled automatic backup in a trusted environment (for example every 6 hours plus daily recovery-check, with 7-day frequent and 30-day daily retention as an initial policy). Retention must be configured server-side; do not delete anything until at least two independently verified backups are retained.
8. Capture the download volume, signed-apk artifact bucket, private content hub bucket and environment/config manifests under separate backup policies. Do not accidentally copy customer secrets into plaintext backup metadata. Record a clean rebuild of distribution from signed artifacts.
9. Test a recovery exercise and record actual RPO (max potential lost data) and RTO (time to restore). Suggested initial **targets**, not guarantees: RPO <= 6h; RTO <= 2h for control-plane backup recovery. Proper hot-standby/replication has tighter targets but must be separately architected/tested.
10. Add a separate health monitor and human pager for 5xx, real video/audio stalls, backup freshness and disk volume usage. **Do not automatically restart a production database on a single failed health check.** Preserve the latest known-good deployment and a manual rollback route.

## What is NOT redundant yet

- **DB**: one live instance; a logical dump is disaster recovery, not instantaneous failover. A standby PostgreSQL cluster with independently monitored replication and controlled promotion is needed for HA. Backups remain mandatory even with streaming replication.
- **Content source**: external provider/XTREAM errors `xtream_transport_unreachable` cannot be fixed by database backups. Licensed secondary feeds and correct rate limits must be validated separately; do not blindly mirror unauthorized media.
- **Customers**: an HTTP 200 check is not proof of decoded video/audio. Keep independently verified real-device QoE release gates from PR #805.

## Synthetic CI

`.github/workflows/blofy-stream-dr-backup-qa.yml` builds a fake subscriber database in a throwaway PostgreSQL 18 container, produces a compressed custom-format dump, restores into a different scratch database, and checks row count. No production data, live media streams, Railway or AWS S3 are contacted. Passing CI is **not** evidence of a real protected off-site backup.

## First controlled production operation (NOT executed by QA)

Record:
- Backup run UTC start/finish, size, object key, checksum, expiry/retention and KMS ID (not the database URI/password).
- Remote object metadata verification and independent download SHA validation.
- Isolated restore started/finished, restored object count, migration checks, application health, data reconciliation.
- Recovery owner and decision to activate rotation / alarms.

Do not enable automatic backup schedules until the first two production backup-and-restore drills pass. Never change customer routing, DNS, credentials, subscription entitlements or production DB contents as part of a backup smoke test.

## Verified bugs corrected by the extended synthetic workflow

The previous manual GitHub backup workflow installed an unspecified PostgreSQL client, which could be older than the **PostgreSQL 18** server. It now installs `postgresql-client-18` explicitly.

The old backup script tried `PGDATABASE="$DATABASE_URL" pg_dump`. In the full backup-chain CI it attempted a local Unix socket rather than connecting through the supplied connection URI. This is corrected via `exec-with-postgres-dsn.py`, which parses the URI into libpq environment variables and execs `pg_dump` without embedding passwords in process arguments. Unknown URI settings fail closed.

The new `test_backup_chain.sh` exercises the actual backup scripts against fake PostgreSQL subscriber rows and a **mock**, not real, AWS object store; it validates a complete scratch restore, rejects altered downloaded bytes, and rejects inconsistent remote hash metadata. CI #45208995548 completed successfully.

### Railway-native backups are a complementary recovery layer

Railway documents snapshots for mounted volumes with separate Daily (6-day retention), Weekly (27-day), and Monthly (89-day) schedules. Configure these **on both** the PostgreSQL volume and the update-distribution /data volume under the Railway service **Backups** tab. A restore swaps the mounted volume and redeploys, and is limited to the same project/environment; it is not a geographically independent off-site backup. The available connected Railway tool API has no volume-backup-schedule action, so this code change does not enable those schedules or prove they already exist.

Railway now documents PostgreSQL point-in-time recovery (PITR), where archived WAL plus base backups support recovery to an earlier time, and an HA PostgreSQL conversion with automatic failover. Each alters production database management and requires separate verified readiness. In particular, Railway notes **active connections are dropped during HA conversion** and endpoints can change. Do not enable live HA/PITR conversion casually while paid customer sessions are active. Start with backups and a rehearsed restore, then evaluate HA in a maintenance window with a tested rollback.

Docs:
- https://docs.railway.com/volumes/backups
- https://docs.railway.com/volumes/point-in-time-recovery
- https://docs.railway.com/databases/postgresql-ha

### CI safety exception / release-blocking status

The production-source base branch was already failing the separate **BLOFY Activation CI** and **BLOFY Device Administration** workflows on 2026-11-23. These failures are unrelated to the synthetic off-site backup job, but they are still release blockers. This draft PR must not be represented as fully green or merge-ready solely because its backup-specific workflow passed.
