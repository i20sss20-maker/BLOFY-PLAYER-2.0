"""Realistic log formats; only synthetic process/stack records are used."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from play_crash_identity import PACKAGE, target_crashes_after_test


class CrashIdentityTests(unittest.TestCase):
    def target(self, text): self.assertTrue(target_crashes_after_test(text))
    def foreign(self, text): self.assertEqual(target_crashes_after_test(text), [])

    def test_exact_app(self): self.target('Process: '+PACKAGE+', PID: 100\nerror')
    def test_cmdline(self): self.target('Cmdline: '+PACKAGE+'\nsignal 11 (SIGSEGV)')
    def test_native_identity(self): self.target('pid: 100, tid: 101, name: main  >>> '+PACKAGE+' <<<')
    def test_app_subprocesses_are_not_ignored(self):
        for suffix in ('native', 'test', 'player'):
            with self.subTest(suffix=suffix): self.target('Process: '+PACKAGE+':'+suffix+', PID: 1')
    def test_separate_test_package_stack_is_not_app_process(self):
        self.foreign('Process: '+PACKAGE+'.test, PID: 1\nat '+PACKAGE+'.Foo.call(Foo.kt:1)')
    def test_foreign_stack_mention(self):
        self.foreign('Process: another.app, PID: 1\nat '+PACKAGE+'.Foo.call(Foo.kt:1)')
    def test_default_threadtime_is_recognized(self):
        self.target('09-14 03:00:00.123  100  100 E AndroidRuntime: Process: '+PACKAGE+', PID: 100')
    def test_year_threadtime_is_recognized(self):
        self.target('2026-09-14 03:00:00.123456  100  100 F DEBUG   : Cmdline: '+PACKAGE)
    def test_brief_is_recognized(self):
        self.target('E/AndroidRuntime(  100): Process: '+PACKAGE+', PID: 100')
    def test_native_threadtime(self):
        self.target('09-14 03:00:00.123  100  101 F DEBUG   : pid: 100, tid: 101, name: main >>> '+PACKAGE+':native <<<')
    def test_later_app_after_foreign_crash_without_second_buffer_header(self):
        self.target('--------- beginning of crash\nProcess: another.app, PID: 1\nerror\nProcess: '+PACKAGE+', PID: 2\nerror')
    def test_later_foreign_does_not_erase_first_app(self):
        self.target('Process: '+PACKAGE+', PID: 1\nerror\nProcess: another.app, PID: 2')
    def test_every_native_identity_checked(self):
        self.target('Cmdline: other.app\nerror\nCmdline: '+PACKAGE+'\nerror')
    def test_prefixed_later_app(self):
        self.target('09-14 03:00:00.123  100  100 E AndroidRuntime: Process: other.app, PID: 100\n09-14 03:00:00.124  200  200 E AndroidRuntime: Process: '+PACKAGE+', PID: 200')
    def test_unknown_target_record_rejected(self): self.target('unattributed '+PACKAGE+' record')
    def test_unknown_target_after_foreign_fatal_rejected(self):
        self.target('Process: other.app, PID: 1\nerror\nFATAL EXCEPTION: main\nmissing identity '+PACKAGE)
    def test_invalid_identity_with_target_rejected(self):
        self.target('Process: [unavailable]\nat '+PACKAGE+'.Foo.bar(Foo.kt:1)')
    def test_nearby_package_not_target(self): self.foreign('Process: '+PACKAGE+'other, PID: 1')
    def test_empty_buffer_header(self): self.foreign('--------- beginning of crash\n')
    def test_empty_log(self): self.foreign('')
    def test_many_foreign_records_do_not_hide_target(self):
        self.target(('Process: unrelated.app, PID: 1\nerror\n'*20)+'Process: '+PACKAGE+', PID: 2')
    def test_raw_foreign_fatal_stack(self):
        self.foreign('FATAL EXCEPTION: main\nProcess: android.system, PID: 1\njava.lang.Error: x\nat '+PACKAGE+'.Foo.call(Foo.kt:1)')


if __name__ == '__main__': unittest.main()
