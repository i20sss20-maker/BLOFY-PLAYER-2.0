"""Regression tests for the Play runtime's measured 16 KB publication gate."""
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from probe_android_page_size import PROBE_SOURCE, probe_android_page_size, require_16kb_output


class PageSizeEvidenceTests(unittest.TestCase):
    def test_accepts_two_16kb_runtime_readings(self):
        for value in ("16384 16384", "16384 16384\n", "16384 16384\r\n"):
            with self.subTest(value=value):
                self.assertEqual(require_16kb_output(value), 16384)

    def test_rejects_4kb(self):
        with self.assertRaisesRegex(RuntimeError, "measured 4096"):
            require_16kb_output("4096 4096\n")

    def test_rejects_other_matching_sizes(self):
        for value in ("0 0", "8192 8192", "65536 65536"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                require_16kb_output(value)

    def test_rejects_disagreeing_apis(self):
        for value in ("4096 16384", "16384 4096"):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "disagree"):
                require_16kb_output(value)

    def test_rejects_missing_or_malformed_evidence(self):
        for value in ("", "16384", "16 KB", "16384 16384\n4096 4096\n", "-16384 -16384", "getconf: not found", "warning\n16384 16384", "16384 16384 ", "16384.0 16384.0"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                require_16kb_output(value)

    def test_probe_measures_bionic_instead_of_returning_a_constant(self):
        self.assertIn("sysconf(_SC_PAGESIZE)", PROBE_SOURCE)
        self.assertIn("getpagesize()", PROBE_SOURCE)
        self.assertNotIn("16384", PROBE_SOURCE)
        self.assertNotIn("4096", PROBE_SOURCE)


class PageSizeProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.sdk = self.root / "sdk"
        self.run = self.root / "run"
        self.run.mkdir()
        self.version = "28.0.13004108"
        self.compiler_dir = self.sdk / "ndk" / self.version / "toolchains/llvm/prebuilt/linux-x86_64/bin"
        self.compiler_dir.mkdir(parents=True)
        (self.compiler_dir / "x86_64-linux-android35-clang").touch()
        (self.compiler_dir / "aarch64-linux-android35-clang").touch()
        self.abi = "x86_64"
        self.output = "16384 16384\n"
        self.adb = Mock(side_effect=self.respond)
        self.command = Mock(return_value="")

    def respond(self, *args, **kwargs):
        if args == ("shell", "getprop", "ro.product.cpu.abi"):
            return self.abi + "\n"
        if len(args) == 2 and args[0] == "shell" and args[1].startswith("/data/local/tmp/"):
            return self.output
        return ""

    def probe(self):
        return probe_android_page_size(self.adb, self.command, sdk=self.sdk, ndk_version=self.version, run=self.run)

    def test_x86_64_probe_and_cleanup(self):
        self.assertEqual(self.probe(), 16384)
        args = self.command.call_args.args
        self.assertEqual(args[0], self.compiler_dir / "x86_64-linux-android35-clang")
        self.assertIn("-Wl,-z,max-page-size=16384", args)
        self.assertIn("-pie", args)
        self.assertNotIn("-static", args)
        self.assertEqual(list(self.run.iterdir()), [])
        self.assertFalse(any("getconf" in call.args for call in self.adb.call_args_list))
        remote = self.adb.call_args_list[1].args[2]
        self.assertEqual(self.adb.call_args_list[-1].args, ("shell", "rm", "-f", remote))

    def test_arm64_probe_uses_matching_compiler(self):
        self.abi = "arm64-v8a"
        self.assertEqual(self.probe(), 16384)
        self.assertEqual(self.command.call_args.args[0].name, "aarch64-linux-android35-clang")

    def test_4kb_runtime_fails_after_cleanup(self):
        self.output = "4096 4096\n"
        with self.assertRaisesRegex(RuntimeError, "4096"):
            self.probe()
        self.assertEqual(self.adb.call_args_list[-1].args[:3], ("shell", "rm", "-f"))

    def test_malformed_runtime_fails_after_cleanup(self):
        self.output = "16 KB enabled"
        with self.assertRaisesRegex(RuntimeError, "Malformed"):
            self.probe()
        self.assertEqual(self.adb.call_args_list[-1].args[:3], ("shell", "rm", "-f"))

    def test_unknown_abi_fails_before_compilation(self):
        self.abi = "armeabi-v7a"
        with self.assertRaisesRegex(RuntimeError, "Unsupported ABI"):
            self.probe()
        self.command.assert_not_called()
        self.assertEqual(self.adb.call_count, 1)

    def test_invalid_ndk_path_is_rejected(self):
        self.version = "../other"
        with self.assertRaisesRegex(RuntimeError, "Invalid pinned"):
            self.probe()
        self.command.assert_not_called()

    def test_missing_compiler_fails_without_device_writes(self):
        (self.compiler_dir / "x86_64-linux-android35-clang").unlink()
        with self.assertRaisesRegex(RuntimeError, "compiler is missing"):
            self.probe()
        self.command.assert_not_called()
        self.assertEqual(self.adb.call_count, 1)

    def test_compiler_failure_stops_before_push(self):
        self.command.side_effect = subprocess.CalledProcessError(1, "clang")
        with self.assertRaises(subprocess.CalledProcessError):
            self.probe()
        self.assertEqual(self.adb.call_count, 1)
        self.assertEqual(list(self.run.iterdir()), [])

    def test_remote_execution_failure_is_not_accepted(self):
        def fail(*args, **kwargs):
            if len(args) == 2 and args[0] == "shell" and args[1].startswith("/data/local/tmp/"):
                raise RuntimeError("probe execution failed")
            return self.respond(*args, **kwargs)
        self.adb.side_effect = fail
        with self.assertRaisesRegex(RuntimeError, "execution failed"):
            self.probe()
        self.assertEqual(self.adb.call_args_list[-1].args[:3], ("shell", "rm", "-f"))

    def test_push_failure_attempts_only_scoped_cleanup(self):
        def fail(*args, **kwargs):
            if args[0] == "push":
                raise RuntimeError("push failed")
            return self.respond(*args, **kwargs)
        self.adb.side_effect = fail
        with self.assertRaisesRegex(RuntimeError, "push failed"):
            self.probe()
        self.assertEqual(self.adb.call_args_list[-1].args[:3], ("shell", "rm", "-f"))

    def test_cleanup_failure_is_not_reported_as_success(self):
        def fail(*args, **kwargs):
            if args[:3] == ("shell", "rm", "-f"):
                raise RuntimeError("cleanup failed")
            return self.respond(*args, **kwargs)
        self.adb.side_effect = fail
        with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
            self.probe()


if __name__ == "__main__":
    unittest.main()
