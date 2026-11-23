#!/usr/bin/env python3
"""Bounded, read-only live media decoder probe for operator-authorized sources.

Requires ffmpeg. Verifies decoded frames and audio on the probe host only,
NOT real customer device playback. Never writes stream URLs to reports.
"""
import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import time
from pathlib import Path

VIDEO = re.compile(r'Parsed_showinfo_\d+.*\bn:\s*\d+\s+pts:')
AUDIO = re.compile(r'Parsed_ashowinfo_\d+.*\bn:\s*\d+\s+pts:')


def percentile(values, pct):
    return sorted(values)[max(0, math.ceil(len(values) * pct) - 1)] if values else None


def safe_label(source):
    return hashlib.sha256(source.encode()).hexdigest()[:10]


async def single_viewer(source, viewer, duration, gap_threshold, restarts, realtime=False):
    clock = asyncio.get_running_loop()
    deadline = clock.time() + duration
    result = dict(source=safe_label(source), viewer=viewer, videoFrames=0,
                  audioFrames=0, firstFrameMs=[], videoStallsSec=[],
                  audioStallsSec=[], reconnections=0, recoveryMs=[],
                  earlyEnds=0, decoderErrors=0)
    last_video = last_audio = None
    stalled_video_since = stalled_audio_since = None
    recovery_since = None
    for attempt in range(restarts + 1):
        if clock.time() >= deadline:
            break
        started = clock.time()
        first_video_this_attempt = False
        cmd = ['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'info',
               '-rw_timeout', '12000000']
        if realtime:
            cmd += ['-re']
        cmd += ['-i', source, '-map', '0:v:0', '-map', '0:a:0?',
                '-vf', 'showinfo', '-af', 'ashowinfo', '-f', 'null', '-']
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE)
        except OSError:
            result['decoderErrors'] += 1
            break
        while clock.time() < deadline:
            try:
                line = await asyncio.wait_for(process.stderr.readline(), timeout=0.4)
            except asyncio.TimeoutError:
                line = None
            now = clock.time()
            if line:
                msg = line.decode('utf-8', errors='replace')
                if VIDEO.search(msg):
                    result['videoFrames'] += 1
                    if not first_video_this_attempt:
                        first_video_this_attempt = True
                        result['firstFrameMs'].append(round((now - started) * 1000))
                        if recovery_since is not None:
                            result['recoveryMs'].append(round((now - recovery_since) * 1000))
                            recovery_since = None
                    if stalled_video_since is not None:
                        result['videoStallsSec'].append(round(now - stalled_video_since, 2))
                        stalled_video_since = None
                    last_video = now
                if AUDIO.search(msg):
                    result['audioFrames'] += 1
                    if stalled_audio_since is not None:
                        result['audioStallsSec'].append(round(now - stalled_audio_since, 2))
                        stalled_audio_since = None
                    last_audio = now
            if last_video is not None and now - last_video > gap_threshold and stalled_video_since is None:
                stalled_video_since = last_video
            if last_audio is not None and now - last_audio > gap_threshold and stalled_audio_since is None:
                stalled_audio_since = last_audio
            if process.returncode is not None or (line == b'' and process.stderr.at_eof()):
                break
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        if clock.time() >= deadline - 0.05:
            break
        result['earlyEnds'] += 1
        result['decoderErrors'] += int(process.returncode not in (0, None))
        if attempt < restarts:
            result['reconnections'] += 1
            recovery_since = clock.time()
            await asyncio.sleep(min(1.0, max(0, deadline - clock.time())))
    for field, when in [('videoStallsSec', stalled_video_since),
                        ('audioStallsSec', stalled_audio_since)]:
        if when is not None:
            result[field].append(round(max(0, clock.time() - when), 2))
    result['videoDecoded'] = result['videoFrames'] > 0
    result['audioDecoded'] = result['audioFrames'] > 0
    return result


async def run(args):
    if not args.sources:
        raise ValueError('Provide at least one explicitly approved test source')
    if len(args.sources) * args.clients > 8:
        raise ValueError('Safety limit: 8 total parallel decoder sessions')
    t0 = time.time()
    tasks = [single_viewer(source, viewer, args.duration, args.stall_sec,
                           args.restarts, args.realtime)
             for source in args.sources for viewer in range(1, args.clients + 1)]
    sessions = await asyncio.gather(*tasks)
    startup = [v for x in sessions for v in x['firstFrameMs'][:1]]
    recoveries = [v for x in sessions for v in x['recoveryMs']]
    failed = [x for x in sessions if not x['videoDecoded'] or
              (args.require_audio and not x['audioDecoded'])]
    summary = dict(checkedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t0)),
                   measurement='ffmpeg_decoder_probe_not_customer_device',
                   durationSeconds=args.duration, viewerCount=len(sessions),
                   startupP50Ms=percentile(startup, .5),
                   startupP95Ms=percentile(startup, .95),
                   videoStalls=sum(len(x['videoStallsSec']) for x in sessions),
                   audioStalls=sum(len(x['audioStallsSec']) for x in sessions),
                   earlyEnds=sum(x['earlyEnds'] for x in sessions),
                   recoveredProcesses=sum(len(x['recoveryMs']) for x in sessions),
                   recoveryP95Ms=percentile(recoveries, .95),
                   viewersWithMissingTracks=len(failed))
    summary['passed'] = (not failed and summary['videoStalls'] == 0 and
                         summary['audioStalls'] == 0 and summary['earlyEnds'] == 0 and
                         summary['startupP95Ms'] is not None and
                         summary['startupP95Ms'] <= args.max_startup_ms)
    report = {'summary': summary, 'sessions': sessions}
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if summary['passed'] else 2


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', dest='sources', action='append', default=[],
                   help='Operator-authorized URL; avoid CLI for credentialed sources')
    p.add_argument('--duration', type=int, default=120)
    p.add_argument('--clients', type=int, default=2)
    p.add_argument('--stall-sec', type=float, default=3.0)
    p.add_argument('--restarts', type=int, default=2)
    p.add_argument('--require-audio', action='store_true')
    p.add_argument('--max-startup-ms', type=int, default=6000)
    p.add_argument('--realtime', action='store_true',
                   help='Pace finite offline QA fixture like live stream')
    p.add_argument('--report', help='Optional JSON output (no URLs)')
    args = p.parse_args()
    if os.getenv('BLOFY_QOE_SOURCES'):
        extra = json.loads(os.environ['BLOFY_QOE_SOURCES'])
        if not isinstance(extra, list) or not all(isinstance(x, str) for x in extra):
            p.error('BLOFY_QOE_SOURCES must be a JSON array')
        args.sources.extend(extra)
    if not (5 <= args.duration <= 3600 and 1 <= args.clients <= 8 and
            .5 <= args.stall_sec <= 30 and 0 <= args.restarts <= 5):
        p.error('Out of safety bounds')
    raise SystemExit(asyncio.run(run(args)))


if __name__ == '__main__':
    main()
