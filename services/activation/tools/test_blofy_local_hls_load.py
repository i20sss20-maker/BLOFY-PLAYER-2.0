import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'load_qa', Path(__file__).with_name('blofy-local-hls-load.py'))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class LoadQA(unittest.TestCase):
    def test_refuses_remote_targets_before_network(self):
        with patch.object(qa.http.client, 'HTTPConnection') as conn:
            for url in ['https://example.invalid/a.ts',
                        'http://127.0.0.1:80/a.ts',
                        'http://127.0.0.1:3021@example.invalid/a.ts']:
                with self.assertRaises(ValueError):
                    qa.fetch(url)
            conn.assert_not_called()

    def test_stalled_viewers_fail_even_after_initial_progress(self):
        with patch.object(qa, 'viewer', return_value=(True, 0, 1000, [.1], 9.0)):
            result = qa.stage(5, 15)
        self.assertFalse(result['passed'])
        self.assertEqual(result['max_progress_gap_seconds'], 9.0)

    def test_healthy_viewers_pass(self):
        with patch.object(qa, 'viewer', return_value=(True, 0, 1000, [.1], 3.0)):
            result = qa.stage(5, 15)
        self.assertTrue(result['passed'])
        self.assertEqual(result['progressing_viewers'], 5)

    def test_errors_fail_stage(self):
        with patch.object(qa, 'viewer', return_value=(True, 1, 1000, [.1], 3.0)):
            self.assertFalse(qa.stage(5, 15)['passed'])

    def test_slow_segments_fail_stage(self):
        with patch.object(qa, 'viewer', return_value=(True, 0, 1000, [2.1], 3.0)):
            self.assertFalse(qa.stage(5, 15)['passed'])


if __name__ == '__main__':
    unittest.main()
