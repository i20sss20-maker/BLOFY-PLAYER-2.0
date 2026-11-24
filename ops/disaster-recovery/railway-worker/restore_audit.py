#!/usr/bin/env python3
"""One-time isolated restore exercise using encrypted existing backup only.

NEVER connects to live Postgres; it starts a temporary Unix-socket-only local
Postgres 18 instance, restores the archive and destroys the scratch cluster.
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time

import boto3
from botocore.client import Config
from worker import decrypt_file, digest_file, safe_env
from verify_latest import inspect_latest_receipt

KEY_PATTERN = re.compile(r"^blofy-dr/postgres/[0-9]{4}/[0-9]{2}/[0-9]{2}/[0-9]{6}Z-[0-9a-f]{12}\.dump\.gcm$")


def die(reason):
    print(json.dumps({"ok": False, "test": "isolated_full_restore",
                      "error": reason}, separators=(",", ":")), flush=True)
    raise SystemExit(2)


def cmd(args, timeout=120, capture=False):
    # Do not capture pipe handles inherited by the local PostgreSQL daemon:
    # pg_ctl would complete but communicate() can otherwise block forever.
    # Reject inherited libpq connection/service options for every scratch command.
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG") and k != "DATABASE_URL"}
    return subprocess.run(args, check=True,
                          stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=timeout,
                          env=env)


def main():
    if os.getenv("BLOFY_RESTORE_AUDIT_ENABLED") != "true":
        die("restore_audit_disabled")
    if os.getenv("DATABASE_URL") or os.getenv("PGHOST"):
        die("production_db_connection_forbidden")
    try:
        object_key = safe_env("BLOFY_RESTORE_OBJECT_KEY")
        if object_key != "latest-verified" and not KEY_PATTERN.fullmatch(object_key):
            raise ValueError("object_key_invalid")
        key = bytes.fromhex(safe_env("BLOFY_BACKUP_AES256_KEY_HEX"))
        if len(key) != 32:
            raise ValueError("key_invalid")
        endpoint = safe_env("BLOFY_BACKUP_ENDPOINT")
        if not endpoint.startswith("https://"):
            raise ValueError("non_tls_endpoint")
        bucket = safe_env("BLOFY_BACKUP_BUCKET")
        region = safe_env("BLOFY_BACKUP_REGION")
        access = safe_env("BLOFY_BACKUP_ACCESS_KEY_ID")
        secret = safe_env("BLOFY_BACKUP_SECRET_ACCESS_KEY")
    except (ValueError, TypeError):
        die("restore_required_settings_invalid")
    start = time.monotonic()
    s3 = boto3.client(
        "s3", endpoint_url=endpoint, region_name=region,
        aws_access_key_id=access, aws_secret_access_key=secret,
        config=Config(signature_version="s3v4",
                      s3={"addressing_style": "virtual"},
                      connect_timeout=10, read_timeout=60,
                      retries={"max_attempts": 3, "mode": "standard"}))
    bdir = pathlib.Path("/usr/lib/postgresql/18/bin")
    if not all((bdir / cmdname).exists() for cmdname in ("initdb", "pg_ctl", "postgres")):
        die("postgresql18_scratch_binaries_missing")
    try:
        receipt = None
        if object_key == "latest-verified":
            receipt = inspect_latest_receipt(s3, bucket, include_archive=True)
            object_key = receipt["archive_key"]
        with tempfile.TemporaryDirectory(prefix="blofy-restore-") as d:
            root = pathlib.Path(d)
            remote, archive = root / "archive.gcm", root / "archive.dump"
            meta = s3.head_object(Bucket=bucket, Key=object_key)
            expected_sha = (meta.get("Metadata") or {}).get("sha256", "")
            if not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
                raise ValueError("missing_ciphertext_hash")
            if receipt and (expected_sha != receipt["encrypted_sha256"] or
                            meta.get("ContentLength") != receipt["object_bytes"]):
                raise ValueError("archive_changed_since_verified_receipt")
            s3.download_file(bucket, object_key, str(remote))
            if remote.stat().st_size != meta.get("ContentLength") or digest_file(remote) != expected_sha:
                raise ValueError("download_hash_invalid")
            decrypt_file(remote, archive, key)
            cmd(["pg_restore", "--list", str(archive)], timeout=90)
            pgdata = root / "data"
            sock = root / "sock"
            sock.mkdir()
            cmd([str(bdir / "initdb"), "-D", str(pgdata), "-A", "trust", "--no-instructions"],
                timeout=90)
            running = False
            try:
                cmd([str(bdir / "pg_ctl"), "-D", str(pgdata),
                     "-o", "-c listen_addresses='' -c unix_socket_directories=" + str(sock),
                     "-w", "start"], timeout=90)
                running = True
                cmd(["createdb", "-h", str(sock), "-U", "postgres", "restore_audit"], timeout=45)
                cmd(["pg_restore", "-h", str(sock), "-U", "postgres",
                     "--no-owner", "--no-acl", "--exit-on-error",
                     "-d", "restore_audit", str(archive)], timeout=1200)
                n = cmd(["psql", "-h", str(sock), "-U", "postgres",
                         "-d", "restore_audit", "-qAt", "-c",
                         "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"],
                        timeout=45, capture=True)
                table_count = int(n.stdout.decode("ascii", "strict").strip())
                if table_count <= 0:
                    raise ValueError("no_user_tables_after_restore")
            finally:
                if running:
                    try:
                        cmd([str(bdir / "pg_ctl"), "-D", str(pgdata),
                             "-m", "immediate", "-w", "stop"], timeout=45)
                    except Exception:
                        pass
        print(json.dumps({
            "ok": True, "test": "isolated_full_restore",
            "object_key": object_key, "full_database_restore_verified": True,
            "user_tables_restored": table_count,
            "production_database_contacted": False,
            "elapsed_seconds": round(time.monotonic()-start, 2)
        }, separators=(",", ":")), flush=True)
    except Exception as exc:
        die("restore_failed:"+type(exc).__name__)


if __name__ == "__main__":
    main()
