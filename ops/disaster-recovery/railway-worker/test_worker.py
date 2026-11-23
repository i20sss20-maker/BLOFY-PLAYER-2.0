#!/usr/bin/env python3
"""Isolated tests: no real subscriber DB, S3 account or network traffic."""
import importlib.util
import pathlib
import tempfile
import unittest
from cryptography.exceptions import InvalidTag

spec = importlib.util.spec_from_file_location(
    "dr_worker", pathlib.Path(__file__).with_name("worker.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


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
