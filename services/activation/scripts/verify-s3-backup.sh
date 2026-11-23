#!/usr/bin/env bash
# Operator-only: verify a private SSE-KMS S3 backup object and PostgreSQL TOC.
# Does not restore, mutate, or connect to any live database.
set -Eeuo pipefail
umask 077
: "${BLOFY_BACKUP_S3_BUCKET:?Private backup S3 bucket required}"
: "${BLOFY_BACKUP_OBJECT_KEY:?Exact backup object key required}"
: "${AWS_REGION:?AWS region required}"
for cmd in aws sha256sum pg_restore mktemp stat; do
  command -v "$cmd" >/dev/null || { echo "missing_dependency:${cmd}" >&2; exit 1; }
done
bucket="$BLOFY_BACKUP_S3_BUCKET"
key="$BLOFY_BACKUP_OBJECT_KEY"
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]] ||
   [[ ! "$key" =~ ^blofy-stream/postgres/[a-zA-Z0-9._-]+\.dump$ ]]; then
  echo 'invalid_bucket_or_backup_key' >&2; exit 1
fi
remote="$(aws s3api head-object --bucket "$bucket" --key "$key" \
  --region "$AWS_REGION" \
  --query '[ContentLength,ServerSideEncryption,Metadata.checksumsha256]' \
  --output text)"
read -r expected_bytes cipher expected_sha <<< "$remote"
if [[ "$cipher" != "aws:kms" || ! "$expected_sha" =~ ^[a-f0-9]{64}$ ]] ||
   ! [[ "$expected_bytes" =~ ^[1-9][0-9]+$ ]]; then
  echo 'object_not_verified_as_encrypted_pg_dump' >&2; exit 1
fi

dir="$(mktemp -d)"
chmod 700 "$dir"
trap 'rm -rf -- "$dir"' EXIT
aws s3 cp "s3://${bucket}/${key}" "$dir/backup.dump" \
  --region "$AWS_REGION" --only-show-errors
actual_bytes="$(stat -c '%s' "$dir/backup.dump")"
actual_sha="$(sha256sum "$dir/backup.dump" | cut -d ' ' -f 1)"
if [[ "$actual_bytes" != "$expected_bytes" ||
      "$actual_sha" != "$expected_sha" ]]; then
  echo 'download_sha256_verification_failed' >&2; exit 1
fi
pg_restore --list "$dir/backup.dump" >/dev/null
echo 'encrypted_offsite_backup_integrity_verified'
echo 'full_database_restore_still_required=true'
