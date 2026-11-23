# BLOFY STREAM — independent-region private backup worker

This service runs **only** a read-only PostgreSQL `pg_dump` and stores a client-side AES-256-GCM encrypted copy in a different Railway bucket region. It does not restart customers, write to PostgreSQL, alter account codes or contact media sources.

- **Source of truth:** `Postgres.DATABASE_URL` through Railway reference variable.
- **Destination:** `blofy-stream-subscription-dr-iad` private bucket in Railway IAD region, NOT the production AMS region.
- **Encryption:** AES-256-GCM client-side, with distinct 32-byte secret retained **outside Railway** by operator. The 12-byte nonce is random per archive. The S3 service never receives plaintext. Never commit encryption keys to GitHub.
- **Verification on each run:** real PostgreSQL custom-format archive, local TOC, encryption, upload/head-object metadata, downloaded SHA256, authenticated decryption and full byte-for-byte archive digest. **This is not the same as restoring a database into an isolated Postgres instance**, which still needs a separately controlled exercise.

Environment variables: `BLOFY_BACKUP_ENABLED=true`, `DATABASE_URL`, `BLOFY_BACKUP_AES256_KEY_HEX`, `BLOFY_BACKUP_ENDPOINT`, `BLOFY_BACKUP_BUCKET`, `BLOFY_BACKUP_REGION`, `BLOFY_BACKUP_ACCESS_KEY_ID`, `BLOFY_BACKUP_SECRET_ACCESS_KEY`.

The worker **fails closed** without all settings, requires a private Railway database hostname and TLS S3 endpoint, and never outputs usernames/passwords or plaintext records in logs. AWS keys and DB password are referenced from their parent services, not copied into repository files. One instance only. Runs as Linux `postgres` user with no public HTTP domain.

**Operational safety:** keep no persistent local volume. Set an explicit cron schedule after the first actual backup succeeds and note the first successful object key, size and time. Configure independently owned notifications on late backups and prolonged real 5xx. Backups in Railway, even across regions, are not independent of the Railway provider and are not a substitute for AWS/GCS/offline copies or HA failover. Offsite private-vault restoration, RPO/RTO testing and DB HA conversion still remain.

**Key recovery:** A single inaccessible/missing decryption key makes all these backups unreadable. Owner must securely store the key outside Railway (an independent password manager/vault and protected offline copy) before treating this as robust DR. Do not share keys or backups in public issues.

## Persistent receipt and independent verifier (added 2026-11-23)

After a successful database snapshot, encryption, S3 upload, independent download,
AES-GCM authenticated decrypt, TOC and SHA-256 roundtrip, the backup worker saves
`blofy-dr/status/latest-verified.json` in the **private** IAD bucket.
This receipt contains only UTC verification time, encrypted-object path, object
size and ciphertext SHA-256; no customer records, tokens or database URI.
The writer reads back the receipt before reporting overall success.

The independent Railway cron service `blofy-db-backup-verifier` runs
`python3 /app/verify_latest.py` and is deliberately **not connected to
PostgreSQL, the AES key, payments or live media**. It reads the private receipt,
requires the latest verification to be within 8 hours, and independently checks
that the referenced encrypted object still exists and its SHA-256/size metadata
agree. It exits with a nonzero code if verification fails. Railway's cron
execution status is then a durable signal available to the hourly monitoring
agent, without depending on a short-lived worker's stdout stream.

**Proof boundary:** a successful verifier proves that a recent verified
receipt and the referenced encrypted archive's S3 HEAD agree; it does **not**
re-download and decrypt the entire archive each hour and does not replace the
separately documented full database restore exercise. The archive remains
inside Railway (different region), not in an independent provider.

Recommended production schedule: writer `0 */6 * * *` UTC; verifier
`20 * * * *` UTC. Keep both tasks single-replica, no public domains, no
persistent storage. Never start manual backups in a loop or extend connection
limits to diagnose viewer problems.
