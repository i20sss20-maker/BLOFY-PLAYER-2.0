import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('r8_review',Path(__file__).resolve().parents[1]/'run_r8_instrumentation.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)

def output():
    text=''
    for name in sorted(review.EXPECTED):
        for status in [1,0]:
            text+=f'INSTRUMENTATION_STATUS: class={review.CLASS}\nINSTRUMENTATION_STATUS: test={name}\nINSTRUMENTATION_STATUS_CODE: {status}\n'
    return text+'INSTRUMENTATION_CODE: -1\n'

class EvidenceTests(unittest.TestCase):
    def check(self,text,expected):
        self.assertEqual(review.all_passed(text,review.completed_cases(text)),expected)
    def test_complete_six_pass(self): self.check(output(),True)
    def test_empty_not_success(self): self.check('',False)
    def test_runner_failure_not_success(self): self.check(output().replace('INSTRUMENTATION_CODE: -1','INSTRUMENTATION_CODE: 0'),False)
    def test_skipped_case_not_success(self): self.check(output().replace('INSTRUMENTATION_STATUS_CODE: 0','INSTRUMENTATION_STATUS_CODE: -3',1),False)
    def test_assumption_not_success(self): self.check(output().replace('INSTRUMENTATION_STATUS_CODE: 0','INSTRUMENTATION_STATUS_CODE: -4',1),False)
    def test_failure_not_success(self): self.check(output().replace('INSTRUMENTATION_STATUS_CODE: 0','INSTRUMENTATION_STATUS_CODE: -2',1),False)
    def test_crash_not_success(self): self.check(output()+'INSTRUMENTATION_FAILED: Process crashed',False)
    def test_wrong_class_not_success(self): self.check(output().replace(review.CLASS,'other.Class'),False)
    def test_duplicate_cases_not_success(self): self.check(output()+output(),False)
    def test_malformed_dex_rejected(self):
        for data in [b'',b'\x00'*112,b'dex\n035\x00'+b'\xff'*104]:
            with self.assertRaises(ValueError): review.dex_classes(data)

if __name__=='__main__': unittest.main()
