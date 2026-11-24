#!/usr/bin/env python3
"""BLOFY private, single-shot Railway backup: no production database writes.

Database -> pg_dump custom archive -> AES-256-GCM encrypted file -> remote-region
private S3 bucket -> re-download -> authenticated decrypt -> pg_restore TOC.
No user/media data are printed. Requires an OFFLINE second copy of the key.
"""
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import parse_qsl, unquote, urlsplit

import boto3
from botocore.client import Config
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"BLOFYDR1"
BUFSIZE = 1024 * 1024


def fail(error):
    print(json.dumps({"ok": False, "error": error}, separators=(",", ":")), flush=True)
    raise SystemExit(2)


def safe_env(name):
    val = os.getenv(name, "")
    if not val or any(ord(ch) < 32 for ch in val):
        raise ValueError("missing_or_invalid_"+name.lower())
    return val


def database_env(url, parent_env=None):
    """Restrict dump destinations to Railway private network only."""
    parsed = urlsplit(url)
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
        raise ValueError("invalid_database_url")
    if not parsed.hostname.endswith(".railway.internal"):
        raise ValueError("database_must_be_private_railway_network")
    if not parsed.username or not parsed.path or parsed.path == "/" or parsed.fragment:
        raise ValueError("invalid_database_identity")
    db = unquote(parsed.path[1:])
    if not db or "/" in db:
        raise ValueError("invalid_database_name")
    params = dict(parse_qsl(parsed.query, strict_parsing=True))
    if set(params) - {"sslmode", "connect_timeout"}:
        raise ValueError("unsupported_database_url_options")
    env = dict(parent_env or os.environ)
    for key in ("DATABASE_URL","PGHOST","PGPORT","PGUSER","PGPASSWORD","PGDATABASE","PGSERVICE"):
        env.pop(key, None)
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
               PGUSER=unquote(parsed.username), PGDATABASE=db,
               PGCONNECT_TIMEOUT=params.get("connect_timeout", "8"))
    if parsed.password is not None:
        env["PGPASSWORD"] = unquote(parsed.password)
    if "sslmode" in params:
        env["PGSSLMODE"] = params["sslmode"]
    return env


def digest_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as src:
        for chunk in iter(lambda: src.read(BUFSIZE), b""):
            h.update(chunk)
    return h.hexdigest()


def encrypt_file(source, target, key):
    nonce = secrets.token_bytes(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    with open(source, "rb") as src, open(target, "wb") as dst:
        dst.write(MAGIC + nonce)
        for block in iter(lambda: src.read(BUFSIZE), b""):
            dst.write(cipher.update(block))
        dst.write(cipher.finalize())
        dst.write(cipher.tag)  # 16-byte authentication tag
    return target.stat().st_size


def decrypt_file(source, target, key):
    length = source.stat().st_size
    if length < len(MAGIC) + 12 + 16 + 64:
        raise ValueError("encrypted_object_too_small")
    with open(source, "rb") as src, open(target, "wb") as dst:
        header = src.read(len(MAGIC))
        if header != MAGIC:
            raise ValueError("encrypted_format_invalid")
        nonce = src.read(12)
        src.seek(-16, 2)
        tag = src.read(16)
        remaining = length - len(MAGIC) - 12 - 16
        src.seek(len(MAGIC) + 12)
        decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        while remaining > 0:
            block = src.read(min(BUFSIZE, remaining))
            if not block:
                raise ValueError("unexpected_eof")
            dst.write(decryptor.update(block))
            remaining -= len(block)
        dst.write(decryptor.finalize())  # InvalidTag on corruption


# Short machine-readable, non-customer receipt is stored ONLY in the private
# bucket. A separate read-only cron verifier can check archive freshness and
# HEAD metadata even when Railway drops short-lived job stdout.
LATEST_RECEIPT_KEY = "blofy-dr/status/latest-verified.json"
RECEIPT_SCHEMA = "blofy-dr-receipt-v1"


def publish_verified_receipt(client, bucket, archive_key, sha256, object_bytes, at=None):
    if at is None:
        at = datetime.now(timezone.utc)
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "verified_at": at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "archive_key": archive_key,
        "encrypted_sha256": sha256,
        "object_bytes": int(object_bytes),
        "upload_head_verified": True,
        "downloaded_checksum_verified": True,
        "decrypt_and_archive_verified": True,
        "full_database_restore_verified": False,
    }
    body = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(body) > 4096:
        raise ValueError("backup_receipt_too_large")
    client.put_object(Bucket=bucket, Key=LATEST_RECEIPT_KEY, Body=body,
                      ContentType="application/json", CacheControl="no-store")
    stored = client.get_object(Bucket=bucket, Key=LATEST_RECEIPT_KEY)
    if int(stored.get("ContentLength", -1)) != len(body):
        raise ValueError("backup_receipt_remote_length_mismatch")
    downloaded = stored["Body"].read(4097)
    if downloaded != body:
        raise ValueError("backup_receipt_remote_body_mismatch")
    return receipt


def main():
    if os.getenv("BLOFY_BACKUP_ENABLED") != "true":
        fail("backup_disabled_by_default")
    try:
        dsn = safe_env("DATABASE_URL")
        key = bytes.fromhex(safe_env("BLOFY_BACKUP_AES256_KEY_HEX"))
        if len(key) != 32:
            fail("invalid_aes256_key")
        endpoint = safe_env("BLOFY_BACKUP_ENDPOINT")
        if not endpoint.startswith("https://"):
            fail("non_tls_bucket_endpoint_denied")
        bucket = safe_env("BLOFY_BACKUP_BUCKET")
        region = safe_env("BLOFY_BACKUP_REGION")
        access_id = safe_env("BLOFY_BACKUP_ACCESS_KEY_ID")
        access_secret = safe_env("BLOFY_BACKUP_SECRET_ACCESS_KEY")
        pg_env = database_env(dsn)
    except (ValueError, TypeError):
        fail("required_backup_settings_missing_or_invalid")

    config = Config(signature_version="s3v4",
                    s3={"addressing_style": "virtual"},
                    connect_timeout=10, read_timeout=60,
                    retries={"max_attempts": 3, "mode": "standard"})
    client = boto3.client("s3", endpoint_url=endpoint, region_name=region,
                          aws_access_key_id=access_id,
                          aws_secret_access_key=access_secret, config=config)
    started = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y/%m/%d/%H%M%SZ")
    object_key = "blofy-dr/postgres/" + stamp + "-" + secrets.token_hex(6) + ".dump.gcm"
    try:
        with tempfile.TemporaryDirectory(prefix="blofy-dr-") as tmp:
            root = pathlib.Path(tmp)
            dump, encrypted, downloaded, restored = [
                root / name for name in ("backup.dump", "backup.dump.gcm", "downloaded.gcm", "verify.dump")
            ]
            env = {**pg_env, "PGAPPNAME": "blofy-private-backup"}
            # One connection, lock wait bounded to avoid interfering with paying customers.
            subprocess.run(["pg_dump", "--format=custom", "--compress=6",
                            "--no-owner", "--no-acl", "--lock-wait-timeout=10s",
                            "--file="+str(dump)],
                           env=env, check=True, timeout=900,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if dump.stat().st_size < 1000:
                raise ValueError("dump_unexpectedly_small")
            subprocess.run(["pg_restore", "--list", str(dump)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            encrypted_bytes = encrypt_file(dump, encrypted, key)
            ciphertext_sha = digest_file(encrypted)

            # No plaintext object is sent. Railway S3 private bucket is in another
            # region; it is NOT a provider-independent disaster recovery vault.
            client.upload_file(
                str(encrypted), bucket, object_key,
                ExtraArgs={"Metadata": {"sha256": ciphertext_sha, "format": "aes256gcm-v1"}}
            )
            head = client.head_object(Bucket=bucket, Key=object_key)
            meta = head.get("Metadata") or {}
            if int(head.get("ContentLength", -1)) != encrypted_bytes or (
                meta.get("sha256") != ciphertext_sha
            ):
                raise ValueError("remote_object_integrity_metadata_mismatch")
            client.download_file(bucket, object_key, str(downloaded))
            if digest_file(downloaded) != ciphertext_sha:
                raise ValueError("downloaded_ciphertext_sha256_mismatch")
            decrypt_file(downloaded, restored, key)
            subprocess.run(["pg_restore", "--list", str(restored)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if digest_file(restored) != digest_file(dump):
                raise ValueError("decrypted_dump_mismatch")
            # Only after all previous remote/download/decrypt checks succeeded
            # persist a private receipt that a separate cron can validate.
            publish_verified_receipt(client, bucket, object_key,
                                     ciphertext_sha, encrypted_bytes)
            # Publish only non-sensitive backup audit evidence.
            print(json.dumps({
                "ok": True, "kind": "private_cross_region_encrypted_backup",
                "key": object_key, "object_bytes": encrypted_bytes,
                "ciphertext_sha256": ciphertext_sha,
                "roundtrip_verified": True, "archive_toc_verified": True,
                "full_database_restore_verified": False,
                "elapsed_seconds": round(time.monotonic()-started, 2)
            }, separators=(",", ":")), flush=True)
    except Exception as exc:
        # Do not leak traceback or exception messages; subprocess/S3 errors can
        # contain sensitive connection details.
        fail("backup_or_roundtrip_verification_failed:"+type(exc).__name__)


if __name__ == "__main__":
    main()
