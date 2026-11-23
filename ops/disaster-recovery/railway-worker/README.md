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
