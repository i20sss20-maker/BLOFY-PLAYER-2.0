import importlib.util
from pathlib import Path
import unittest
import struct
spec=importlib.util.spec_from_file_location('r8_review',Path(__file__).resolve().parents[1]/'run_r8_instrumentation.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)

def output():
    text=''
    for name in sorted(review.EXPECTED):
        for status in [1,0]:
            text+=f'INSTRUMENTATION_STATUS: class={review.CLASS}\nINSTRUMENTATION_STATUS: test={name}\nINSTRUMENTATION_STATUS_CODE: {status}\n'
    return text+'INSTRUMENTATION_CODE: -1\n'

def dex(*descriptors, marker=b''):
    """Small DEX class-table fixture; each build marker produces distinct bytes."""
    count = len(descriptors)
    strings, types, classes = 112, 112 + 4*count, 112 + 8*count
    data = bytearray(classes + 32*count)
    data[:8] = b'dex\n035\x00'
    for offset, start in [(56, strings), (64, types), (96, classes)]:
        struct.pack_into('<II', data, offset, count, start)
    for i, descriptor in enumerate(descriptors):
        encoded = descriptor.encode()
        assert len(encoded) < 128
        struct.pack_into('<I', data, strings + 4*i, len(data))
        struct.pack_into('<I', data, types + 4*i, i)
        struct.pack_into('<I', data, classes + 32*i, i)
        data.extend(bytes([len(encoded)]) + encoded + b'\x00')
    return bytes(data) + marker


class L8ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.tests = dex('L' + review.CLASS.replace('.', '/') + ';', 'Lorg/junit/Assert;')
        self.l8 = dex('Lj$/util/Objects;', 'La/a;')
    def split(self, entries=None, evidence=None):
        return review.partition_test_dex(
            entries if entries is not None else [('classes.dex', self.tests), ('classes2.dex', self.l8)],
            evidence if evidence is not None else [self.l8])
    def test_exact_l8_output_with_obfuscated_names_preserves_test_bytes(self):
        removed, retained = self.split()
        self.assertEqual([x['entry'] for x in removed], ['classes2.dex'])
        self.assertEqual(retained, [('classes.dex', self.tests)])
    def test_mixed_l8_and_test_code_rejected(self):
        mixed = dex('Lj$/util/Objects;', 'L' + review.CLASS.replace('.', '/') + ';')
        with self.assertRaises(AssertionError): self.split([('classes.dex', mixed)])
    def test_unproven_all_j_dex_rejected(self):
        with self.assertRaises(AssertionError):
            self.split([('classes.dex', self.tests), ('classes2.dex', dex('Lj$/util/Objects;'))])
    def test_same_names_with_different_bytes_rejected(self):
        with self.assertRaises(AssertionError):
            self.split(evidence=[dex('Lj$/util/Objects;', 'La/a;', marker=b'another-build')])
    def test_missing_evidence_rejected(self):
        with self.assertRaises(AssertionError): self.split(evidence=[])
    def test_unmatched_additional_evidence_rejected(self):
        with self.assertRaises(AssertionError): self.split(evidence=[self.l8, dex('Lj$/time/Instant;')])
    def test_duplicate_packaged_l8_rejected(self):
        with self.assertRaises(AssertionError):
            self.split([('classes.dex', self.tests), ('classes2.dex', self.l8), ('classes3.dex', self.l8)])
    def test_test_code_cannot_be_labelled_l8_evidence(self):
        mixed = dex('Lj$/util/Objects;', 'L' + review.CLASS.replace('.', '/') + ';')
        with self.assertRaises(AssertionError): self.split(evidence=[mixed])
    def test_missing_contract_test_rejected(self):
        with self.assertRaises(AssertionError):
            self.split([('classes.dex', dex('Lother/Test;')), ('classes2.dex', self.l8)])

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
