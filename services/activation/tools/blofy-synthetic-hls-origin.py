#!/usr/bin/env python3
"""Create synthetic 720p HLS in a temporary directory and run local capacity QA.

Run on the test host only. No customer media, provider access, credentials,
firewall changes, public listener, or persistent service. Defaults to 5 viewers.
"""
import argparse
from functools import partial
import http.server
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time

spec = importlib.util.spec_from_file_location(
    'load_qa', Path(__file__).with_name('blofy-local-hls-load.py'))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class Origin(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if not re.fullmatch(r'/(index\.m3u8|segment-[0-9]+\.ts)', self.path):
            self.send_error(404)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-synthetic', action='store_true', required=True)
    parser.add_argument('--max-viewers', type=int, choices=qa.STAGES, default=5)
    parser.add_argument('--seconds', type=int, choices=range(15, 121),
                        default=30, metavar='15..120')
    args = parser.parse_args()
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        parser.error('ffmpeg is required; nothing was installed')
    with tempfile.TemporaryDirectory(prefix='blofy-synthetic-hls-') as tmp:
        root = Path(tmp)
        # Bind first: a busy port aborts instead of hitting an existing origin.
        with Server(('127.0.0.1', 3021), partial(Origin, directory=tmp)) as server:
            with (root / 'ffmpeg.log').open('wb') as log:
                worker = subprocess.Popen([
                    ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error',
                    '-re', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
                    '-threads', '2', '-pix_fmt', 'yuv420p', '-b:v', '1500k',
                    '-maxrate', '1500k', '-bufsize', '3000k',
                    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
                    '-c:a', 'aac', '-b:a', '96k',
                    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6',
                    '-hls_delete_threshold', '6',
                    '-hls_flags', 'delete_segments+independent_segments+temp_file',
                    '-hls_segment_filename', str(root / 'segment-%09d.ts'),
                    str(root / 'index.m3u8')
                ], stdout=subprocess.DEVNULL, stderr=log)
                thread = None
                try:
                    ready_by = time.monotonic() + 35
                    while time.monotonic() < ready_by:
                        if worker.poll() is not None:
                            raise RuntimeError('synthetic encoder exited before readiness')
                        if len(list(root.glob('segment-*.ts'))) >= 3 and (root / 'index.m3u8').is_file():
                            break
                        time.sleep(.25)
                    else:
                        raise RuntimeError('synthetic encoder readiness timeout')
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    for count in qa.STAGES:
                        if count > args.max_viewers:
                            break
                        result = qa.stage(count, args.seconds)
                        result['encoder_alive'] = worker.poll() is None
                        result['passed'] = result['passed'] and result['encoder_alive']
                        result['scope'] = 'synthetic-loopback-only'
                        print(json.dumps(result), flush=True)
                        if not result['passed']:
                            return 1
                    return 0
                finally:
                    if thread is not None:
                        server.shutdown()
                        thread.join(timeout=5)
                    if worker.poll() is None:
                        worker.terminate()
                        try:
                            worker.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            worker.kill()
                            worker.wait(timeout=5)


if __name__ == '__main__':
    raise SystemExit(main())
