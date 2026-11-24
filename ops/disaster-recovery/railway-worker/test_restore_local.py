#!/usr/bin/env python3
"""Synthetic-only end-to-end restore audit test inside the non-root DR image."""
import contextlib
import hashlib
import io
import json
from datetime import datetime, timezone, timedelta
import os
import pathlib
import shutil
import subprocess
import tempfile
from unittest.mock import patch

import restore_audit
from worker import encrypt_file


def run(argv):
    return subprocess.run(argv, check=True, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=90)


def main():
    key = bytes(range(32))
    object_key = "blofy-dr/postgres/2026/11/23/161051Z-123456789abc.dump.gcm"
    bin_dir = pathlib.Path("/usr/lib/postgresql/18/bin")
    with tempfile.TemporaryDirectory(prefix="blofy-fake-source-") as folder:
        root = pathlib.Path(folder)
        pgdata, sock = root / "source_db", root / "socket"
        sock.mkdir()
        run([str(bin_dir / "initdb"), "-D", str(pgdata), "-A", "trust", "--no-instructions"])
        run([str(bin_dir / "pg_ctl"), "-D", str(pgdata),
             "-o", "-c listen_addresses='' -c unix_socket_directories="+str(sock), "-w", "start"])
        try:
            run(["createdb", "-h", str(sock), "-U", "postgres", "synthetic_subscriber_db"])
            run(["psql", "-h", str(sock), "-U", "postgres", "-d", "synthetic_subscriber_db",
                 "-c", "CREATE TABLE fake_subscriptions(id integer PRIMARY KEY, status text NOT NULL);"
                       "INSERT INTO fake_subscriptions VALUES (1,'active'),(2,'expired');"])
            dump = root / "synthetic.dump"
            run(["pg_dump", "-h", str(sock), "-U", "postgres", "-d", "synthetic_subscriber_db",
                 "-Fc", "-f", str(dump)])
        finally:
            run([str(bin_dir / "pg_ctl"), "-D", str(pgdata), "-m", "immediate", "-w", "stop"])
        ciphertext = root / "test.dump.gcm"
        encrypt_file(dump, ciphertext, key)
        checksum = hashlib.sha256(ciphertext.read_bytes()).hexdigest()

        class FakeS3:
            stale = False
            changed = False
            head_calls = 0
            def get_object(self, **kwargs):
                assert kwargs['Key'] == 'blofy-dr/status/latest-verified.json'
                when = datetime.now(timezone.utc) - timedelta(hours=9 if self.stale else 0)
                data = json.dumps({
                    'schema': 'blofy-dr-receipt-v1',
                    'verified_at': when.isoformat().replace('+00:00', 'Z'),
                    'archive_key': object_key, 'encrypted_sha256': checksum,
                    'object_bytes': ciphertext.stat().st_size,
                    'upload_head_verified': True, 'downloaded_checksum_verified': True,
                    'decrypt_and_archive_verified': True
                }).encode()
                return {'ContentLength': len(data), 'Body': io.BytesIO(data)}
            def head_object(self, **kwargs):
                assert kwargs["Key"] == object_key
                self.head_calls += 1
                return {"Metadata": {"sha256": "0"*64 if self.changed and self.head_calls > 1 else checksum},
                        "ContentLength": ciphertext.stat().st_size}
            def download_file(self, bucket, key_name, target):
                assert key_name == object_key
                shutil.copyfile(ciphertext, target)

        values = {
            "BLOFY_RESTORE_AUDIT_ENABLED": "true",
            "BLOFY_RESTORE_OBJECT_KEY": "latest-verified",
            "BLOFY_BACKUP_AES256_KEY_HEX": key.hex(),
            "BLOFY_BACKUP_ENDPOINT": "https://synthetic.example.invalid",
            "BLOFY_BACKUP_BUCKET": "synthetic-not-real",
            "BLOFY_BACKUP_REGION": "auto",
            "BLOFY_BACKUP_ACCESS_KEY_ID": "synthetic-only",
            "BLOFY_BACKUP_SECRET_ACCESS_KEY": "synthetic-only",
        }
        with patch.dict(os.environ, {**values, 'PGHOSTADDR': '192.0.2.1', 'PGSERVICE': 'must-not-be-used'}, clear=True), patch("restore_audit.boto3.client", return_value=FakeS3()):
            capture = io.StringIO()
            with contextlib.redirect_stdout(capture):
                restore_audit.main()
            output = capture.getvalue()
            assert '"full_database_restore_verified":true' in output, output
            assert '"user_tables_restored":1' in output, output
            assert '"production_database_contacted":false' in output, output
        for kind in ('stale', 'changed'):
            fake = FakeS3()
            setattr(fake, kind, True)
            with patch.dict(os.environ, values, clear=True), patch('restore_audit.boto3.client', return_value=fake), patch.object(fake, 'download_file', side_effect=AssertionError('must not download invalid receipt')) as download:
                with contextlib.redirect_stdout(io.StringIO()):
                    try:
                        restore_audit.main()
                    except SystemExit as exc:
                        assert exc.code == 2
                    else:
                        raise AssertionError('unsafe receipt accepted')
                download.assert_not_called()
    print("PASS: encrypted fake S3 backup fully restored in disposable local PostgreSQL 18; no Railway or real subscriber contacted")


if __name__ == "__main__":
    main()
