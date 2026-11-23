#!/usr/bin/env python3
"""Local-only HLS canary: synthetic source, concurrent decoders and controlled outage.
No customer, third-party provider, or remote network endpoints are touched.
Requires ffmpeg + Python >= 3.10. No stream URLs or credentials in report.
"""
import argparse
import asyncio
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import pathlib
import re
import shutil
import tempfile
import threading
import time

VIDEO = re.compile(r'Parsed_showinfo_\d+.*\bn:\s*\d+\s+pts:')
AUDIO = re.compile(r'Parsed_ashowinfo_\d+.*\bn:\s*\d+\s+pts:')

class CanaryServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

class QuietHandler(SimpleHTTPRequestHandler):
    outage = None
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.outage and self.outage.get("active") and self.path.split("?",1)[0].endswith((".m3u8", ".ts")):
            with self.outage["lock"]:
                self.outage["blockedRequests"] += 1
            self.send_error(503, "Synthetic transport blackout")
            return
        super().do_GET()

def percentile(numbers, p):
    return sorted(numbers)[max(0, math.ceil(p*len(numbers))-1)] if numbers else None

async def stop(proc):
    if proc and proc.returncode is None:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), 3)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

async def writer(root):
    cmd = [
        'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12',
        '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264',
        '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
        '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '64k', '-f', 'hls', '-hls_time', '1',
        '-hls_list_size', '6',
        '-hls_flags', 'append_list+delete_segments+omit_endlist',
        '-hls_segment_filename', str(root / 'part_%05d.ts'),
        str(root / 'live.m3u8')
    ]
    return await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL,
                                                stderr=asyncio.subprocess.DEVNULL)

def newest_segment(root):
    segments = sorted(root.glob('part_*.ts'))
    return segments[-1].name if segments else None


async def wait_new_segment(root, before, timeout=12):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        new = newest_segment(root)
        if new and new != before:
            return new
        await asyncio.sleep(.25)
    raise RuntimeError('Synthetic HLS encoder failed to publish a new segment after restart')


async def wait_ready(root, timeout=13):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        pl = root / 'live.m3u8'
        if pl.exists():
            data = pl.read_text(errors='replace')
            if data.count('#EXTINF:') >= 2:
                return
        await asyncio.sleep(.25)
    raise RuntimeError('Local synthetic HLS generator did not produce two segments')

async def viewer(url, index, end_at, origin, outage_info, max_restarts=12):
    result = dict(index=index, videoFrames=0, audioFrames=0,
                  firstVideoMs=None, firstAudioMs=None, videoGaps=[], audioGaps=[],
                  forcedRestarts=0, exits=0, postResumeVideoMs=None,
                  postResumeAudioMs=None)
    first_video = None
    last_video = None
    last_audio = None
    video_gap_open = None
    audio_gap_open = None
    while time.monotonic() < end_at and result['forcedRestarts'] <= max_restarts:
        now = time.monotonic()
        cmd = ['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'info',
               '-rw_timeout', '4000000', '-live_start_index', '-2',
               '-i', url, '-map', '0:v:0', '-map', '0:a:0',
               '-vf', 'showinfo', '-af', 'ashowinfo', '-f', 'null', '-']
        process = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL,
                                                       stderr=asyncio.subprocess.PIPE)
        attempt_started = now
        attempt_has_video = False
        try:
            while time.monotonic() < end_at:
                try:
                    line = await asyncio.wait_for(process.stderr.readline(), timeout=.4)
                except asyncio.TimeoutError:
                    line = None
                now = time.monotonic()
                if line:
                    decoded = line.decode('utf-8', 'replace')
                    if VIDEO.search(decoded):
                        result['videoFrames'] += 1
                        attempt_has_video = True
                        if first_video is None:
                            first_video = now
                            result['firstVideoMs'] = round((now-origin)*1000)
                        if video_gap_open is not None:
                            result['videoGaps'].append(round(now - video_gap_open, 2))
                            video_gap_open = None
                        last_video = now
                        resumed = outage_info.get('resumedAt')
                        if resumed and now >= resumed+1 and result['postResumeVideoMs'] is None:
                            result['postResumeVideoMs'] = round((now-resumed)*1000)
                    if AUDIO.search(decoded):
                        result['audioFrames'] += 1
                        if result['firstAudioMs'] is None:
                            result['firstAudioMs'] = round((now-origin)*1000)
                        if audio_gap_open is not None:
                            result['audioGaps'].append(round(now - audio_gap_open, 2))
                            audio_gap_open = None
                        last_audio = now
                        resumed = outage_info.get('resumedAt')
                        if resumed and now >= resumed+1 and result['postResumeAudioMs'] is None:
                            result['postResumeAudioMs'] = round((now-resumed)*1000)
                if last_video and now-last_video >= 3 and video_gap_open is None:
                    video_gap_open = last_video
                if last_audio and now-last_audio >= 3 and audio_gap_open is None:
                    audio_gap_open = last_audio
                if process.returncode is not None or (line == b'' and process.stderr.at_eof()):
                    result['exits'] += 1
                    break
                if (attempt_has_video and last_video and now-last_video > 5.5) or (not attempt_has_video and now-attempt_started > 8):
                    break
        finally:
            await stop(process)
        if time.monotonic() < end_at:
            result['forcedRestarts'] += 1
            await asyncio.sleep(min(2.0, 0.5 + 0.35*result['forcedRestarts']))
    finish = time.monotonic()
    if video_gap_open is not None:
        result['videoGaps'].append(round(finish-video_gap_open, 2))
    if audio_gap_open is not None:
        result['audioGaps'].append(round(finish-audio_gap_open, 2))
    return result

async def canary(args):
    if not shutil.which('ffmpeg'):
        raise RuntimeError('Install ffmpeg before running synthetic QA')
    with tempfile.TemporaryDirectory(prefix='blofy_local_canary_') as d:
        root = pathlib.Path(d)
        outage = {"lock": threading.Lock(), "blockedRequests": 0, "mode": args.outage_mode, "publisherRestarted": False}
        QuietHandler.outage = outage
        server = CanaryServer(('127.0.0.1', 0), partial(QuietHandler, directory=d))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        source = None
        try:
            source = await writer(root)
            await wait_ready(root)
            started = time.monotonic()
            until = started + args.duration
            url = f'http://127.0.0.1:{server.server_port}/live.m3u8'
            watching = [asyncio.create_task(viewer(url, i+1, until, started, outage))
                        for i in range(args.viewers)]
            if args.outage_at:
                await asyncio.sleep(args.outage_at)
                outage['stoppedAt'] = time.monotonic()
                if args.outage_mode == 'transport':
                    outage['active'] = True
                    await asyncio.sleep(args.outage_seconds)
                    outage['active'] = False
                else:
                    # An actual encoder stop/restart, restricted to this synthetic fixture.
                    before = newest_segment(root)
                    await stop(source)
                    source = None
                    await asyncio.sleep(args.outage_seconds)
                    source = await writer(root)
                    new = await wait_new_segment(root, before)
                    outage['publisherRestarted'] = (new != before)
                outage['resumedAt'] = time.monotonic()
            reports = await asyncio.gather(*watching)
        finally:
            await stop(source)
            server.shutdown()
            server.server_close()
    starts = [r['firstVideoMs'] for r in reports if r['firstVideoMs'] is not None]
    rtts = [r['postResumeVideoMs'] for r in reports if r['postResumeVideoMs'] is not None]
    ready = len(starts)==args.viewers and all(r['firstAudioMs'] is not None for r in reports)
    blocked = outage.get('blockedRequests', 0)
    injection_verified = (blocked > 0 if args.outage_mode == 'transport'
                          else outage.get('publisherRestarted', False))
    if args.outage_at:
        passed = (ready and injection_verified and len(rtts)==args.viewers and
                  all(r['postResumeAudioMs'] is not None for r in reports) and
                  percentile(rtts, .95) <= args.max_recovery_ms)
    else:
        passed = (ready and percentile(starts, .95) <= args.max_startup_ms and
                  sum(len(r['videoGaps']) for r in reports)==0 and
                  sum(len(r['audioGaps']) for r in reports)==0 and
                  sum(r['forcedRestarts'] for r in reports)==0)
    report = {'summary': {
        'kind': 'isolated_synthetic_hls_only',
        'decodedOn': 'CI_runner_not_customer_device',
        'passed': passed, 'viewers': args.viewers, 'durationSeconds': args.duration,
        'outageMode': args.outage_mode if args.outage_at else 'none',
        'syntheticOutageSeconds': args.outage_seconds if args.outage_at else 0,
        'injectionVerified': injection_verified if args.outage_at else None,
        'http503DuringBlackout': blocked,
        'firstVideoP95Ms': percentile(starts, .95),
        'postResumeVideoP95Ms': percentile(rtts, .95),
        'decodedVideoFrames': sum(r['videoFrames'] for r in reports),
        'decodedAudioFrames': sum(r['audioFrames'] for r in reports),
        'videoGaps3s': sum(len(r['videoGaps']) for r in reports),
        'audioGaps3s': sum(len(r['audioGaps']) for r in reports),
        'processRestarts': sum(r['forcedRestarts'] for r in reports),
        'viewersReceivingAfterRestored': len(rtts),
        'limits': 'Validates local ffmpeg decoders; does not prove BLOFY client recovery or quality on real streams.'
    }, 'viewers': reports}
    if args.report:
        pathlib.Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if passed else 2

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--duration', type=int, default=25)
    p.add_argument('--viewers', type=int, default=2)
    p.add_argument('--outage-at', type=int, default=0)
    p.add_argument('--outage-seconds', type=int, default=3)
    p.add_argument('--outage-mode', choices=['transport', 'source'], default='transport')
    p.add_argument('--max-startup-ms', type=int, default=10000)
    p.add_argument('--max-recovery-ms', type=int, default=12000)
    p.add_argument('--report')
    args=p.parse_args()
    if not 10 <= args.duration <= 120 or not 1 <= args.viewers <= 4:
        p.error('Safety bounds: duration 10-120 seconds and at most 4 decoders')
    if args.outage_at and not (5 <= args.outage_at <= args.duration - 12 and 1 <= args.outage_seconds <= 8):
        p.error('Outage must leave at least 12s to restore stream; outage length 1-8s')
    raise SystemExit(asyncio.run(canary(args)))

if __name__ == '__main__':
    main()
