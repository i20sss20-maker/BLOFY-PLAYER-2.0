import contextlib,io
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from verify_play_bundle import PACKAGE,PLAY_CASES,PLAY_CLASS,require_play_runtime_evidence,target_crashes_after_test

def success():
    return ''.join(f'INSTRUMENTATION_STATUS: class={PLAY_CLASS}\nINSTRUMENTATION_STATUS: test={n}\nINSTRUMENTATION_STATUS_CODE: 0\n' for n in sorted(PLAY_CASES))+'INSTRUMENTATION_CODE: -1\n'
class RuntimeEvidence(unittest.TestCase):
    def test_success(self): self.assertEqual(len(require_play_runtime_evidence(success())),3)
    def test_failed_case(self):
        with self.assertRaises(AssertionError): require_play_runtime_evidence(success().replace('STATUS_CODE: 0','STATUS_CODE: -1',1))
    def test_runner_failure(self):
        with self.assertRaises(AssertionError): require_play_runtime_evidence(success()+'Process crashed')
    def test_duplicate_terminal(self):
        with self.assertRaises(AssertionError): require_play_runtime_evidence(success()+'INSTRUMENTATION_CODE: -1\n')
    def test_target_process_crash_is_rejected(self):
        log='--------- beginning of crash\nProcess: '+PACKAGE+', PID: 100\nFATAL EXCEPTION: main\n'
        self.assertEqual(len(target_crashes_after_test(log)),1)
    def test_target_child_is_not_misclassified_as_target(self):
        log='--------- beginning of crash\nProcess: '+PACKAGE+':test, PID: 101\nFATAL EXCEPTION: main\n'
        self.assertEqual(target_crashes_after_test(log),[])
    def test_test_package_is_not_target(self):
        log='--------- beginning of crash\nProcess: '+PACKAGE+'.test, PID: 102\nFATAL EXCEPTION: main\n'
        self.assertEqual(target_crashes_after_test(log),[])
    def test_cmdline_target_is_rejected(self):
        log='--------- beginning of crash\nCmdline: '+PACKAGE+'\nsignal 11 (SIGSEGV)\n'
        self.assertEqual(len(target_crashes_after_test(log)),1)
    def test_unrelated_crash_is_ignored(self):
        self.assertEqual(target_crashes_after_test('--------- beginning of crash\nProcess: android.system, PID: 1\n'),[])
    def test_package_text_in_stack_is_not_process_identity(self):
        self.assertEqual(target_crashes_after_test('--------- beginning of crash\nProcess: other.app, PID: 2\nat '+PACKAGE+'.Foo.bar(Foo.kt:1)\n'),[])
if __name__=='__main__': unittest.main()
