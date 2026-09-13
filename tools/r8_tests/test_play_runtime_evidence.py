"""Only synthetic strings; no device, signing material or application changes."""
import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_play_bundle import (PACKAGE, PLAY_CLASS, PLAY_CASES,
                                crash_structure, require_play_runtime_evidence)


def successful_output():
    return ''.join(f'INSTRUMENTATION_STATUS: class={PLAY_CLASS}\n'
                   f'INSTRUMENTATION_STATUS: test={name}\n'
                   'INSTRUMENTATION_STATUS_CODE: 0\n'
                   for name in sorted(PLAY_CASES)) + 'INSTRUMENTATION_CODE: -1\n'


class PlayRuntimeEvidenceTests(unittest.TestCase):
    def check(self, result, crashes='', success=False):
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            if success:
                self.assertEqual(len(require_play_runtime_evidence(result, crashes)), 3)
            else:
                with self.assertRaisesRegex(AssertionError, 'evidence rejected'):
                    require_play_runtime_evidence(result, crashes)
        return captured.getvalue()

    def test_all_three_successes_and_clean_runner_pass(self):
        self.assertIn('BLOFY_PLAY_RUNTIME_PASS', self.check(successful_output(), success=True))

    def test_android_empty_buffer_header_is_not_a_crash(self):
        self.check(successful_output(), '--------- beginning of crash\n', success=True)

    def test_target_crash_still_fails_after_three_successes(self):
        output = self.check(successful_output(), 'Process: ' + PACKAGE + '\njava.lang.IllegalStateException: fixture')
        diagnostic = json.loads(output.split(' ', 1)[1])
        self.assertTrue(diagnostic['all_three_cases_passed'])
        self.assertTrue(diagnostic['raw_target_crash_detected'])
        self.assertFalse(diagnostic['publication_allowed'])
        self.assertIn('java.lang.IllegalStateException', diagnostic['crash_structure']['exception_types'])

    def test_raw_target_predicate_is_not_replaced_by_sanitized_output(self):
        output = self.check(successful_output(), 'opaque crash payload ' + PACKAGE + ' with no stack')
        self.assertIn('"raw_target_crash_detected": true', output)

    def test_target_native_child_process_cannot_be_filtered_out(self):
        self.check(successful_output(), '>>> ' + PACKAGE + ':native <<<\nsignal 11 (SIGSEGV)')

    def test_non_target_buffer_preserves_existing_gate_semantics(self):
        self.check(successful_output(), 'Process: example.other\n', success=True)

    def test_empty_and_missing_cases_fail(self):
        for value in ('', successful_output().split('INSTRUMENTATION_STATUS: class=', 2)[-1]):
            with self.subTest(value=value): self.check(value)

    def test_failed_skipped_and_assumption_cases_fail(self):
        for status in (-1, -2, -3, -4):
            with self.subTest(status=status):
                self.check(successful_output().replace('INSTRUMENTATION_STATUS_CODE: 0',
                                                     f'INSTRUMENTATION_STATUS_CODE: {status}', 1))

    def test_wrong_class_or_test_name_fails(self):
        self.check(successful_output().replace(PLAY_CLASS, 'other.Test', 1))
        self.check(successful_output().replace(sorted(PLAY_CASES)[0], 'unrelatedCase', 1))

    def test_duplicate_cases_fail(self):
        self.check(successful_output() + successful_output())

    def test_missing_wrong_duplicate_or_conflicting_terminal_code_fails(self):
        for suffix in ('', 'INSTRUMENTATION_CODE: 0\n',
                       'INSTRUMENTATION_CODE: -1\nINSTRUMENTATION_CODE: -1\n',
                       'INSTRUMENTATION_CODE: -1\nINSTRUMENTATION_CODE: 0\n'):
            with self.subTest(suffix=suffix):
                self.check(successful_output().replace('INSTRUMENTATION_CODE: -1\n', suffix))

    def test_runner_failure_text_fails_even_after_success_results(self):
        for suffix in ('INSTRUMENTATION_FAILED: runner stopped', 'Process crashed'):
            with self.subTest(suffix=suffix): self.check(successful_output() + suffix)

    def test_failure_output_never_prints_arbitrary_messages_or_credentials(self):
        private = 'password=do-not-publish deviceId=BLOFY-PRIVATE token=opaque-secret https://private.invalid/media'
        output = self.check(successful_output() + private,
                            'Process: ' + PACKAGE + '\njava.lang.IllegalStateException: ' + private + '\n'
                            'at tv.blofy.player.Test.run(Test.kt:37)\n')
        for value in ('do-not-publish', 'BLOFY-PRIVATE', 'opaque-secret', 'private.invalid', private):
            self.assertNotIn(value, output)
        self.assertIn('tv.blofy.player.Test.run(Test.kt:37)', output)


class StructuralCrashDiagnosticTests(unittest.TestCase):
    def test_java_types_causes_and_code_locations_are_retained(self):
        data = crash_structure('FATAL EXCEPTION: main\njava.lang.AbstractMethodError: arbitrary message\n'
                               'Caused by: java.lang.IllegalStateException: private data\n'
                               '    at tv.blofy.player.Test.run(Test.kt:37)\n'
                               '    at android.os.Looper.loop(Looper.java:221)\n')
        self.assertEqual(data['exception_types'], ['java.lang.AbstractMethodError', 'java.lang.IllegalStateException'])
        self.assertEqual(len(data['java_frames']), 2)
        self.assertNotIn('private data', json.dumps(data))

    def test_native_signal_library_and_offset_are_retained_without_abort_message(self):
        data = crash_structure('signal 11 (SIGSEGV), code 1\n'
                               '#00 pc 00000000000ab120 /data/app/random-private/lib/x86_64/libffmpegJNI.so\n'
                               "Abort message: 'private-value'\n")
        self.assertEqual(data['native_signals'], [('11', 'SIGSEGV')])
        self.assertEqual(data['native_libraries'], ['libffmpegJNI.so'])
        self.assertEqual(data['native_offsets'], [('00', '00000000000ab120')])
        self.assertNotIn('random-private', json.dumps(data))
        self.assertNotIn('private-value', json.dumps(data))

    def test_summary_is_bounded_and_arbitrary_log_lines_are_not_forwarded(self):
        data = crash_structure(('at tv.blofy.player.Test.run(Test.kt:37)\n' * 300) + 'unstructured-sensitive-value')
        self.assertEqual(len(data['java_frames']), 96)
        self.assertEqual(len(data['buffer_sha256']), 64)
        self.assertNotIn('unstructured-sensitive-value', json.dumps(data))


if __name__ == '__main__': unittest.main()
