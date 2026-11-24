#!/usr/bin/env bash
# BLOFY STREAM: private, off-site, KMS-encrypted PostgreSQL logical backup.
# Requires explicit trusted operator configuration; never prints DB credentials.
# No customer routing / schema / entitlement modifications.
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?Private backup DATABASE_URL required}"
: "${BLOFY_BACKUP_S3_BUCKET:?Dedicated private AWS S3 backup bucket required}"
: "${BLOFY_BACKUP_KMS_KEY_ID:?Dedicated AWS KMS key ARN required}"
: "${AWS_REGION:?AWS_REGION required}"

for cmd in python3 pg_dump pg_restore aws sha256sum stat mktemp; do
  command -v "$cmd" >/dev/null || {
    echo "backup_dependency_missing:${cmd}" >&2; exit 1;
  }
done

bucket="$BLOFY_BACKUP_S3_BUCKET"
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]]; then
  echo 'backup_bucket_invalid' >&2; exit 1
fi
if [[ "$BLOFY_BACKUP_KMS_KEY_ID" != arn:aws:kms:* ]]; then
  echo 'backup_kms_arn_invalid' >&2; exit 1
fi

dir="$(mktemp -d)"
chmod 700 "$dir"
trap 'rm -rf -- "$dir"' EXIT
dump="${dir}/backup.dump"

# pg_dump creates a consistent read-only snapshot. Parse the URL into libpq
# environment variables without exposing credentials in the process argv.
python3 "$(dirname "$0")/exec-with-postgres-dsn.py" pg_dump \
  --format=custom --no-owner --no-acl --file="$dump"

# This validates archive TOC readability only, NOT a complete restore.
pg_restore --list "$dump" >/dev/null

bytes="$(stat -c '%s' "$dump")"
if (( bytes < 1000 )); then
  echo 'backup_archive_unexpectedly_small' >&2; exit 1
fi
sha="$(sha256sum "$dump" | cut -d ' ' -f 1)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
key="blofy-stream/postgres/${stamp}-${GITHUB_RUN_ID:-manual}-${nonce}.dump"

# Separate AWS account/region recommended. Bucket must be private, blocked
# public access, versioned, lifecycle managed and with encryption enforced.
aws s3 cp "$dump" "s3://${bucket}/${key}" \
  --region "$AWS_REGION" --sse aws:kms \
  --sse-kms-key-id "$BLOFY_BACKUP_KMS_KEY_ID" \
  --metadata "checksumsha256=${sha},archiveformat=pgcustom" \
  --only-show-errors

# Check destination metadata; no raw customer data is included in logs.
meta="$(aws s3api head-object --bucket "$bucket" --key "$key" \
  --region "$AWS_REGION" \
  --query '[ContentLength,ServerSideEncryption,Metadata.checksumsha256]' \
  --output text)"
read -r remote_bytes remote_cipher remote_sha <<< "$meta"
if [[ "$remote_bytes" != "$bytes" ||
      "$remote_cipher" != "aws:kms" ||
      "$remote_sha" != "$sha" ]]; then
  echo 'backup_uploaded_but_remote_integrity_metadata_failed' >&2
  exit 1
fi

echo "backup_uploaded_and_metadata_verified"
echo "object_key=${key}"
echo "bytes=${bytes}"
echo "sha256=${sha}"
echo "restore_test_required=true"
