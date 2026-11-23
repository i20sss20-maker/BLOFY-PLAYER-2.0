"""Isolated unit regression for the credential-safe libpq URI converter."""
import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / "services/activation/scripts/exec-with-postgres-dsn.py"
spec = importlib.util.spec_from_file_location("libpq_env", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class UriTests(unittest.TestCase):
    def test_password_percent_decoding_and_options(self):
        env = mod.build_env(
            "postgresql://alice:p%40ss%2Fword@db.internal:6432/customer_db?sslmode=require&connect_timeout=4",
            {"DATABASE_URL": "old-password", "PGHOST": "incorrect", "PGSERVICE": "override"}
        )
        self.assertEqual(env["PGHOST"], "db.internal")
        self.assertEqual(env["PGPORT"], "6432")
        self.assertEqual(env["PGPASSWORD"], "p@ss/word")
        self.assertEqual(env["PGDATABASE"], "customer_db")
        self.assertEqual(env["PGSSLMODE"], "require")
        self.assertEqual(env["PGCONNECT_TIMEOUT"], "4")
        self.assertNotIn("DATABASE_URL", env)
        self.assertNotIn("PGSERVICE", env)

    def test_postgres_alias_and_ipv6(self):
        env = mod.build_env("postgres://user:secret@[::1]:5432/test", {})
        self.assertEqual(env["PGHOST"], "::1")
        self.assertEqual(env["PGPASSWORD"], "secret")

    def test_rejects_unsafe_uris_or_unsupported_options(self):
        cases = [
            "mysql://user:secret@host/db",
            "postgresql://user:secret@host",
            "postgresql://user:secret@host:99999/db",
            "postgresql://user:secret@host/db?unknown_option=yes",
            "postgresql://user:secret@host/db?sslmode=require&sslmode=disable",
            "postgresql://user:secret@host/db\nanything",
        ]
        for uri in cases:
            with self.subTest(uri=uri[:20]):
                with self.assertRaises(ValueError):
                    mod.build_env(uri, {})


if __name__ == "__main__":
    unittest.main()
