import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from run_signed_upgrade import one_pass

class UpgradeEvidenceTests(unittest.TestCase):
    def output(self,status=0):
        return f'INSTRUMENTATION_STATUS: class=review.Test\nINSTRUMENTATION_STATUS: test=verify\nINSTRUMENTATION_STATUS_CODE: {status}\nINSTRUMENTATION_CODE: -1\n'
    def test_one_named_success(self): self.assertTrue(one_pass(self.output(),'review.Test','verify'))
    def test_skips_failures_and_assumptions_rejected(self):
        for status in [-1,-2,-3,-4]: self.assertFalse(one_pass(self.output(status),'review.Test','verify'))
    def test_missing_duplicate_wrong_case_and_crash_rejected(self):
        for text in ['',self.output()*2,self.output().replace('test=verify','test=other'),self.output()+'Process crashed']:
            self.assertFalse(one_pass(text,'review.Test','verify'))

if __name__=='__main__': unittest.main()
