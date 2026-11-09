#!/usr/bin/env bash
# Optional OFFSITE full PostgreSQL dump, for a dedicated trusted runner.
# Not activated unless operator configures a private backup environment.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL secret required}"
: "${BLOFY_BACKUP_S3_BUCKET:?Private S3 bucket required}"
: "${BLOFY_BACKUP_KMS_KEY_ID:?KMS key ID required}"
: "${AWS_REGION:?AWS_REGION required}"

for cmd in pg_dump aws; do
  command -v "$cmd" >/dev/null || { echo "backup_dependency_missing: $cmd" >&2; exit 1; }
done

bucket="$BLOFY_BACKUP_S3_BUCKET"
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]]; then
  echo 'backup_bucket_invalid' >&2; exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
key="blofy-postgres/${stamp}-${GITHUB_RUN_ID:-manual}.dump"
# Do not place database URI/password in process argv or stdout.
# The dump is streamed directly to a PRIVATE, SSE-KMS encrypted bucket.
PGDATABASE="$DATABASE_URL" pg_dump --format=custom --no-owner --no-acl |
 aws s3 cp - "s3://${bucket}/${key}" --region "$AWS_REGION" \
  --sse aws:kms --sse-kms-key-id "$BLOFY_BACKUP_KMS_KEY_ID" \
  --only-show-errors
aws s3api head-object --bucket "$bucket" --key "$key" \
 --region "$AWS_REGION" --query '{Length:ContentLength,Encrypted:ServerSideEncryption}' \
 --output json
echo "Backup object uploaded; restore integrity is NOT validated. Run pg_restore --list on a downloaded copy in an isolated environment."
