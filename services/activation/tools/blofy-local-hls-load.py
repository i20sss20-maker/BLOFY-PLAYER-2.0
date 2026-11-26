#!/usr/bin/env python3
"""Bounded HTTP load QA for the isolated synthetic Linode rolling HLS origin only."""
import argparse
import concurrent.futures as cf
import http.client
import json
import math
import threading
import time
from urllib.parse import urljoin, urlsplit

BASE = 'http://127.0.0.1:3021/index.m3u8'
STAGES = (5, 25, 50, 100, 150)
MAX_BYTES = 16 * 1024 * 1024


def fetch(url):
    p = urlsplit(url)
    if p.scheme != 'http' or p.netloc != '127.0.0.1:3021' or p.fragment:
        raise ValueError('non-local URL rejected')
    c = http.client.HTTPConnection('127.0.0.1', 3021, timeout=5)
    start = time.monotonic()
    try:
        c.request('GET', p.path + ('?' + p.query if p.query else ''))
        r = c.getresponse()
        if r.status != 200:
            raise ValueError(f'HTTP {r.status}')
        data = r.read(MAX_BYTES + 1)
        if not data or len(data) > MAX_BYTES:
            raise ValueError('empty or oversized response')
        return data, time.monotonic() - start
    finally:
        c.close()


def viewer(deadline, gate):
    seen = set()
    initial = None
    advanced = False
    last_progress = None
    max_gap = 0.0
    playlist_time = None
    times = []
    size = errors = 0
    gate.wait()
    started = time.monotonic()
    while time.monotonic() < deadline:
        try:
            raw, _ = fetch(BASE)
            lines = [x.strip() for x in raw.decode('utf-8').splitlines()]
            if not lines or lines[0].strip() != '#EXTM3U' or not any(x.startswith('#EXTINF:') for x in lines):
                raise ValueError('not a media playlist')
            segments = [x.strip() for x in lines if x.strip() and not x.startswith('#')]
            if not segments:
                raise ValueError('empty playlist')
            urls = [urljoin(BASE, segment) for segment in segments]
            if any(x == '#EXT-X-ENDLIST' for x in lines):
                raise ValueError('static playlist rejected')
            if initial is None:
                initial = set(urls)
                playlist_time = time.monotonic()
            for url in urls:
                if url in seen:
                    continue
                data, elapsed = fetch(url)
                size += len(data)
                times.append(elapsed)
                seen.add(url)
                if url not in initial:
                    advanced = True
                    now = time.monotonic()
                    max_gap = max(max_gap, now - (last_progress or playlist_time))
                    last_progress = now
                if time.monotonic() >= deadline:
                    break
        except (OSError, ValueError, http.client.HTTPException):
            errors += 1
        time.sleep(max(0, min(1, deadline - time.monotonic())))
    max_gap = max(max_gap, time.monotonic() - (last_progress or started))
    return len(seen) >= 2 and advanced, errors, size, times, max_gap


def stage(count, seconds):
    gate = threading.Event()
    ready = threading.Barrier(count + 1, timeout=15)
    deadline = [None]
    def run():
        ready.wait()
        gate.wait()
        return viewer(deadline[0], gate)
    with cf.ThreadPoolExecutor(max_workers=count) as pool:
        tasks = [pool.submit(run) for _ in range(count)]
        try:
            ready.wait()
        finally:
            deadline[0] = time.monotonic() + seconds
            gate.set()
        rows = [f.result() for f in tasks]
    latencies = sorted(t for r in rows for t in r[3])
    p95 = latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None
    progressed = sum(r[0] for r in rows)
    errors = sum(r[1] for r in rows)
    worst_gap = max(r[4] for r in rows)
    result = dict(viewers=count, progressing_viewers=progressed, errors=errors,
                  segments=len(latencies), bytes=sum(r[2] for r in rows),
                  max_progress_gap_seconds=round(worst_gap, 3),
                  p95_segment_seconds=round(p95, 3) if p95 is not None else None)
    result['passed'] = progressed == count and errors == 0 and p95 is not None and p95 <= 2 and worst_gap <= 8
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-synthetic', action='store_true', required=True,
                        help='confirm port 3021 is serving synthetic QA media, not customer or provider traffic')
    parser.add_argument('--seconds', type=int, default=30, choices=range(15, 121), metavar='15..120')
    parser.add_argument('--max-viewers', type=int, default=150, choices=STAGES)
    args = parser.parse_args()
    for count in STAGES:
        if count > args.max_viewers:
            break
        result = stage(count, args.seconds)
        print(json.dumps(result), flush=True)
        if not result['passed']:
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
