#!/usr/bin/env python3
"""Read-only check of BLOFY's private, separately verified backup receipt.

No database connection, no decryption key, no public service and no media
source access. Designed as an hourly Railway cron whose exit status reflects
whether the remote archive still exists and is recent.
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import boto3
from botocore.client import Config

LATEST_RECEIPT_KEY = "blofy-dr/status/latest-verified.json"
ARCHIVE_KEY = re.compile(
    r"^blofy-dr/postgres/\d{4}/\d{2}/\d{2}/\d{6}Z-[a-f0-9]{12}\.dump\.gcm$"
)
SHA256 = re.compile(r"^[a-f0-9]{64}$")
SCHEMA = "blofy-dr-receipt-v1"


def inspect_latest_receipt(client, bucket, *, now=None, freshness_hours=8, include_archive=False):
    now = now or datetime.now(timezone.utc)
    doc = client.get_object(Bucket=bucket, Key=LATEST_RECEIPT_KEY)
    if not (50 < int(doc.get("ContentLength", -1)) <= 4096):
        raise ValueError("receipt_size_invalid")
    raw = doc["Body"].read(4097)
    if len(raw) > 4096:
        raise ValueError("receipt_size_invalid")
    receipt = json.loads(raw)
    if type(receipt) is not dict or receipt.get("schema") != SCHEMA:
        raise ValueError("receipt_schema_invalid")
    verified_at = receipt.get("verified_at")
    if not isinstance(verified_at, str) or not verified_at.endswith("Z"):
        raise ValueError("receipt_timestamp_invalid")
    try:
        when = datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("receipt_timestamp_invalid") from None
    if when > now + timedelta(minutes=2) or now - when > timedelta(hours=freshness_hours):
        raise ValueError("verified_backup_stale")
    archive_key = receipt.get("archive_key")
    sha256 = receipt.get("encrypted_sha256")
    object_bytes = receipt.get("object_bytes")
    if not isinstance(archive_key, str) or not ARCHIVE_KEY.fullmatch(archive_key):
        raise ValueError("receipt_archive_key_invalid")
    if not isinstance(sha256, str) or not SHA256.fullmatch(sha256):
        raise ValueError("receipt_hash_invalid")
    if type(object_bytes) is not int or object_bytes < 1000:
        raise ValueError("receipt_archive_size_invalid")
    for field in ("upload_head_verified", "downloaded_checksum_verified",
                  "decrypt_and_archive_verified"):
        if receipt.get(field) is not True:
            raise ValueError("receipt_roundtrip_proof_missing")
    # A receipt alone is insufficient. Check the referenced *real* encrypted
    # archive still exists and metadata agrees with what the writer confirmed.
    head = client.head_object(Bucket=bucket, Key=archive_key)
    meta = head.get("Metadata") or {}
    if int(head.get("ContentLength", -1)) != object_bytes or meta.get("sha256") != sha256:
        raise ValueError("archived_ciphertext_head_mismatch")
    return {
        "ok": True,
        "kind": "private_backup_receipt_and_ciphertext_head",
        "last_verified_at": verified_at,
        "object_bytes": object_bytes,
        "age_seconds": max(0, int((now-when).total_seconds())),
        "archive_present": True,
        "archive_metadata_verified": True,
        "full_database_restore_verified": False,
        **({"archive_key": archive_key, "encrypted_sha256": sha256} if include_archive else {}),
    }


def inspect_restore_receipt(client, bucket, *, not_before, now=None):
    """Read-only independent verification of the isolated recovery report."""
    now = now or datetime.now(timezone.utc)
    if not_before.tzinfo is None:
        raise ValueError("restore_minimum_time_invalid")
    doc = client.get_object(Bucket=bucket, Key="blofy-dr/status/latest-restore-audit.json")
    stream = doc["Body"]
    try:
        size = int(doc.get("ContentLength", -1))
        if not 50 < size <= 4096:
            raise ValueError("restore_receipt_size_invalid")
        raw = stream.read(4097)
        if len(raw) != size:
            raise ValueError("restore_receipt_length_mismatch")
    finally:
        stream.close()
    receipt = json.loads(raw)
    if type(receipt) is not dict or receipt.get("schema") != "blofy-dr-restore-audit-v1":
        raise ValueError("restore_receipt_schema_invalid")
    stamp = receipt.get("verified_at")
    if not isinstance(stamp, str) or not stamp.endswith("Z"):
        raise ValueError("restore_receipt_timestamp_invalid")
    when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if when < not_before or when > now + timedelta(minutes=2):
        raise ValueError("restore_receipt_outside_audit_window")
    if receipt.get("ok") is not True or receipt.get("test") != "isolated_full_restore" or receipt.get("full_database_restore_verified") is not True or receipt.get("production_database_contacted") is not False:
        raise ValueError("restore_proof_missing")
    tables = receipt.get("user_tables_restored")
    seconds = receipt.get("elapsed_seconds")
    if type(tables) is not int or tables <= 0 or type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("restore_metrics_invalid")
    archive = receipt.get("object_key")
    checksum = receipt.get("encrypted_sha256")
    if not isinstance(archive, str) or not ARCHIVE_KEY.fullmatch(archive) or not isinstance(checksum, str) or not SHA256.fullmatch(checksum):
        raise ValueError("restore_archive_identity_invalid")
    head = client.head_object(Bucket=bucket, Key=archive)
    if int(head.get("ContentLength", -1)) < 1000 or (head.get("Metadata") or {}).get("sha256") != checksum:
        raise ValueError("restore_archive_head_mismatch")
    return {"ok": True, "kind": "independent_restore_receipt_verification",
            "verified_at": stamp, "user_tables_restored": tables,
            "elapsed_seconds": seconds, "full_database_restore_verified": True,
            "production_database_contacted": False, "archive_metadata_verified": True}


def main():
    try:
        endpoint = os.environ["BLOFY_BACKUP_ENDPOINT"]
        bucket = os.environ["BLOFY_BACKUP_BUCKET"]
        region = os.environ["BLOFY_BACKUP_REGION"]
        access = os.environ["BLOFY_BACKUP_ACCESS_KEY_ID"]
        secret = os.environ["BLOFY_BACKUP_SECRET_ACCESS_KEY"]
        if not endpoint.startswith("https://"):
            raise ValueError("unsafe_s3_endpoint")
        client = boto3.client(
            "s3", endpoint_url=endpoint, region_name=region,
            aws_access_key_id=access, aws_secret_access_key=secret,
            config=Config(signature_version="s3v4",
                          s3={"addressing_style": "virtual"},
                          connect_timeout=10, read_timeout=30,
                          retries={"max_attempts": 3, "mode": "standard"})
        )
        if sys.argv[1:] == ["--restore"]:
            minimum = datetime.fromisoformat(os.environ["BLOFY_RESTORE_AUDIT_NOT_BEFORE"].replace("Z", "+00:00"))
            result = inspect_restore_receipt(client, bucket, not_before=minimum)
        elif not sys.argv[1:]:
            result = inspect_latest_receipt(client, bucket)
        else:
            raise ValueError("unsupported_verification_mode")
        print(json.dumps(result, separators=(",", ":")), flush=True)
    except Exception as exc:
        # Exception messages might include provider endpoint / secrets.
        print(json.dumps({"ok": False, "code": type(exc).__name__,
                          "backup_verified": False}), flush=True)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
