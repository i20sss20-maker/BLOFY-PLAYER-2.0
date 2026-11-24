#!/usr/bin/env python3
"""Isolated tests: no real subscriber DB, S3 account or network traffic."""
import importlib.util
import io
import json
from datetime import datetime, timedelta, timezone
import pathlib
import tempfile
import unittest
from cryptography.exceptions import InvalidTag

spec = importlib.util.spec_from_file_location(
    "dr_worker", pathlib.Path(__file__).with_name("worker.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


verify_spec = importlib.util.spec_from_file_location(
    "verify_latest", pathlib.Path(__file__).with_name("verify_latest.py"))
verifier = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)


class FakePrivateS3:
    def __init__(self):
        self.objects = {}
        self.heads = {}
    def put_object(self, *, Bucket, Key, Body, **kwargs):
        self.objects[Key] = bytes(Body)
    def get_object(self, *, Bucket, Key):
        body = self.objects[Key]
        return {"ContentLength": len(body), "Body": io.BytesIO(body)}
    def head_object(self, *, Bucket, Key):
        if Key not in self.heads:
            raise KeyError("missing_backup_object")
        return self.heads[Key]


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakePrivateS3()
        self.bucket = "synthetic-private-only"
        self.when = datetime(2026, 11, 23, 16, 11, tzinfo=timezone.utc)
        self.key = "blofy-dr/postgres/2026/11/23/161100Z-aabbccddeeff.dump.gcm"
        self.digest = "a" * 64
        self.s3.heads[self.key] = {
            "ContentLength": 5000, "Metadata": {"sha256": self.digest}
        }
        mod.publish_verified_receipt(self.s3, self.bucket,
                                     self.key, self.digest, 5000, self.when)

    def test_remote_backup_receipt_verifies_without_db_or_key(self):
        report = verifier.inspect_latest_receipt(self.s3, self.bucket,
            now=self.when + timedelta(hours=1))
        self.assertTrue(report["ok"])
        self.assertTrue(report["archive_present"])
        self.assertEqual(report["age_seconds"], 3600)
        self.assertFalse(report["full_database_restore_verified"])

    def test_stale_receipt_denied(self):
        with self.assertRaisesRegex(ValueError, "stale"):
            verifier.inspect_latest_receipt(self.s3, self.bucket,
                                            now=self.when + timedelta(hours=9))

    def test_missing_or_modified_archive_head_denied(self):
        del self.s3.heads[self.key]
        with self.assertRaises(KeyError):
            verifier.inspect_latest_receipt(self.s3, self.bucket, now=self.when)
        self.s3.heads[self.key] = {
            "ContentLength": 4999, "Metadata": {"sha256": self.digest}
        }
        with self.assertRaisesRegex(ValueError, "mismatch"):
            verifier.inspect_latest_receipt(self.s3, self.bucket, now=self.when)

    def test_corrupted_or_unverified_receipt_denied(self):
        current = json.loads(self.s3.objects[mod.LATEST_RECEIPT_KEY])
        current["decrypt_and_archive_verified"] = False
        self.s3.objects[mod.LATEST_RECEIPT_KEY] = json.dumps(current).encode()
        with self.assertRaisesRegex(ValueError, "proof_missing"):
            verifier.inspect_latest_receipt(self.s3, self.bucket, now=self.when)


class WorkerTests(unittest.TestCase):
    def test_encryption_roundtrip_for_large_archive(self):
        key = bytes(range(32))
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            original, enc, restored = (root/"original.dump", root/"encrypted.gcm", root/"restored.dump")
            original.write_bytes((b"private-fake-subscription" * 70000) + b"done")
            length = mod.encrypt_file(original, enc, key)
            self.assertEqual(length, enc.stat().st_size)
            self.assertNotIn(b"private-fake-subscription", enc.read_bytes())
            mod.decrypt_file(enc, restored, key)
            self.assertEqual(mod.digest_file(original), mod.digest_file(restored))

    def test_reject_tamper_or_wrong_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            original, enc, restored = root/"x", root/"y", root/"z"
            original.write_bytes(b"fake subscriber data" * 50)
            key = bytes(range(32))
            mod.encrypt_file(original, enc, key)
            self.assertRaises(InvalidTag, mod.decrypt_file, enc, restored, b"Z"*32)
            with open(enc, "r+b") as f:
                f.seek(35); b = f.read(1); f.seek(35); f.write(bytes([b[0] ^ 1]))
            self.assertRaises(InvalidTag, mod.decrypt_file, enc, restored, key)

    def test_database_must_be_private(self):
        cases = [
            "postgresql://user:pass@db.example.com/subscribers",
            "postgresql://user:pass@127.0.0.1/subscribers",
            "postgresql://user:pass@postgres.railway.internal/",
            "mysql://user:pass@postgres.railway.internal/subscribers",
            "postgresql://user:pass@postgres.railway.internal/subscribers?service=unsafe",
        ]
        for dsn in cases:
            with self.subTest(dsn=dsn[:30]):
                with self.assertRaises(ValueError):
                    mod.database_env(dsn, {})

    def test_percent_encoded_password_and_ssl(self):
        result = mod.database_env(
            "postgresql://backup:p%40ss%2Fword@postgres.railway.internal:5432/app?sslmode=require",
            {"DATABASE_URL": "old", "PGPASSWORD": "old"})
        self.assertEqual(result["PGHOST"], "postgres.railway.internal")
        self.assertEqual(result["PGPASSWORD"], "p@ss/word")
        self.assertEqual(result["PGSSLMODE"], "require")
        self.assertNotIn("DATABASE_URL", result)

if __name__ == "__main__":
    unittest.main()
