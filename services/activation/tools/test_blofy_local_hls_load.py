import importlib.util
import http.server
import re
import threading
import time
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



class LocalHTTPFixture(unittest.TestCase):
    def run_fixture(self, frozen):
        # CI-only synthetic bytes, no provider media, no external interface.
        started = time.monotonic()
        class Origin(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == '/index.m3u8':
                    seq = 0 if frozen else int((time.monotonic() - started) / .5)
                    body = ('#EXTM3U\n#EXT-X-VERSION:3\n'
                            '#EXT-X-TARGETDURATION:1\n'
                            f'#EXT-X-MEDIA-SEQUENCE:{seq}\n' +
                            ''.join(f'#EXTINF:0.5,\n/s{i}.ts\n'
                                    for i in range(seq, seq + 3))).encode()
                    mime = 'application/vnd.apple.mpegurl'
                elif re.fullmatch(r'/s[0-9]+\.ts', self.path):
                    body = b'x' * 32768
                    mime = 'video/mp2t'
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        class Server(http.server.ThreadingHTTPServer):
            request_queue_size = 128

        with Server(('127.0.0.1', 3021), Origin) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                return qa.stage(5, 4)
            finally:
                server.shutdown()
                thread.join(timeout=3)

    def test_rolling_playlist_real_http(self):
        result = self.run_fixture(False)
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['progressing_viewers'], 5)
        self.assertGreater(result['bytes'], 0)

    def test_frozen_playlist_real_http(self):
        result = self.run_fixture(True)
        self.assertFalse(result['passed'], result)
        self.assertEqual(result['progressing_viewers'], 0)
        self.assertEqual(result['errors'], 0)


if __name__ == '__main__':
    unittest.main()
