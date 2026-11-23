#!/usr/bin/env bash
# Exercise real production backup scripts against LOCAL fake subscriber rows
# and a mock private object store. No AWS or Railway production connectivity.
set -Eeuo pipefail
umask 077
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/bin" "$root/object"

cat > "$root/bin/aws" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
: "${BLOFY_MOCK_OBJECT_DIR:?}"
if [[ "$1" == s3 && "$2" == cp ]]; then
  shift 2
  src="$1"; dst="$2"; shift 2
  if [[ "$src" == s3://* ]]; then
    cp "$BLOFY_MOCK_OBJECT_DIR/dump" "$dst"
  else
    metadata=""; sse=""; kms=""
    while (($#)); do
      case "$1" in
        --metadata) metadata="$2"; shift 2 ;;
        --sse) sse="$2"; shift 2 ;;
        --sse-kms-key-id) kms="$2"; shift 2 ;;
        --region) shift 2 ;;
        --only-show-errors) shift ;;
        *) echo "unrecognized_mock_aws_option" >&2; exit 4 ;;
      esac
    done
    [[ "$dst" == s3://blofy-qa-private-test/* ]]
    [[ "$sse" == aws:kms && "$kms" == arn:aws:kms:us-east-1:000000000000:key/synthetic-only ]]
    [[ "$metadata" =~ checksumsha256=([a-f0-9]{64}),archiveformat=pgcustom ]]
    cp "$src" "$BLOFY_MOCK_OBJECT_DIR/dump"
    printf '%s' "${BASH_REMATCH[1]}" > "$BLOFY_MOCK_OBJECT_DIR/sha"
    stat -c '%s' "$src" > "$BLOFY_MOCK_OBJECT_DIR/length"
  fi
elif [[ "$1" == s3api && "$2" == head-object ]]; then
  if [[ "${BLOFY_MOCK_BAD_SHA:-0}" == 1 ]]; then
    printf '%s\taws:kms\t%s\n' "$(cat "$BLOFY_MOCK_OBJECT_DIR/length")" "$(printf '0%.0s' {1..64})"
  else
    printf '%s\taws:kms\t%s\n' "$(cat "$BLOFY_MOCK_OBJECT_DIR/length")" "$(cat "$BLOFY_MOCK_OBJECT_DIR/sha")"
  fi
else
  echo 'unsupported_mock_aws_operation' >&2
  exit 4
fi
MOCK
chmod 700 "$root/bin/aws"
export PATH="$root/bin:$PATH"
export BLOFY_MOCK_OBJECT_DIR="$root/object"
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/synthetic_blofy"
export BLOFY_BACKUP_S3_BUCKET="blofy-qa-private-test"
export BLOFY_BACKUP_KMS_KEY_ID="arn:aws:kms:us-east-1:000000000000:key/synthetic-only"
export AWS_REGION="us-east-1"
export PGPASSWORD="postgres"

bash services/activation/scripts/backup-to-s3.sh > "$root/upload.log"
key="$(sed -n 's/^object_key=//p' "$root/upload.log")"
[[ "$key" =~ ^blofy-stream/postgres/.*\.dump$ ]]
export BLOFY_BACKUP_OBJECT_KEY="$key"
bash services/activation/scripts/verify-s3-backup.sh > "$root/verified.log"
grep -q '^encrypted_offsite_backup_integrity_verified$' "$root/verified.log"

createdb blofy_mock_restore_qa
pg_restore --no-owner --no-acl --exit-on-error -d blofy_mock_restore_qa "$root/object/dump"
count="$(psql -XAt -d blofy_mock_restore_qa -c 'select count(*) from synthetic_subscriptions')"
[[ "$count" == 3 ]]
echo "PASS: real pg_dump -> mock encrypted S3 -> SHA verification -> scratch restore"

printf '\ncorrupted-test-tail\n' >> "$root/object/dump"
if bash services/activation/scripts/verify-s3-backup.sh > "$root/reject.log" 2>&1; then
  echo 'FAIL: tampered remote object accepted' >&2; exit 1
fi
echo "PASS: tampered remote backup rejected"

if BLOFY_MOCK_BAD_SHA=1 bash services/activation/scripts/backup-to-s3.sh > "$root/bad-meta.log" 2>&1; then
  echo 'FAIL: mismatch in object metadata accepted' >&2; exit 1
fi
echo "PASS: upload with bad remote metadata rejected"
