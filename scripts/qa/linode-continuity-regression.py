#!/usr/bin/env python3
"""Offline synthetic MPEG-TS generation handoff regression; no production changes."""
import json
import subprocess
import tempfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60).stdout


def packet_bounds(segment):
    data = json.loads(run('ffprobe', '-v', 'error', '-show_packets', '-show_entries',
                          'packet=stream_index,pts_time,dts_time,duration_time',
                          '-of', 'json', str(segment)))
    bounds = defaultdict(list)
    for p in data['packets']:
        for field in ('pts_time', 'dts_time'):
            t = Decimal(p[field]); duration = Decimal(p['duration_time'])
            assert duration > 0
            bounds[(p['stream_index'], field)].append((t, t + duration))
    assert len(bounds) == 4
    return {k: (min(x[0] for x in v), max(x[1] for x in v)) for k, v in bounds.items()}


def generate(source, directory, offset):
    directory.mkdir()
    run('ffmpeg', '-nostdin', '-v', 'error', '-i', str(source), '-t', '8',
        '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-bsf:v',
        'h264_mp4toannexb,dump_extra=freq=keyframe', '-output_ts_offset', str(offset),
        '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
        '-hls_segment_options', 'mpegts_flags=+initial_discontinuity',
        '-hls_segment_filename', str(directory / 'seg_%d.ts'), str(directory / 'index.m3u8'))
    files = sorted(directory.glob('seg_*.ts'))
    assert len(files) == 4
    return files


def verify(source, root):
    baseline = generate(source, root / 'baseline', 0)
    raw_start = packet_bounds(baseline[0])
    previous = None
    playlist = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0']
    for i in range(3):
        offset = Decimal(0) if previous is None else max(
            previous[k][1] - raw_start[k][0] for k in raw_start) + Decimal('0.04')
        directory = root / f'g{i}'
        segments = generate(source, directory, offset)
        if previous is not None:
            current = packet_bounds(segments[0])
            assert all(current[k][0] >= previous[k][1] for k in current), 'packet time overlap'
            playlist.append('#EXT-X-DISCONTINUITY')
        previous = packet_bounds(segments[-1])
        for line in (directory / 'index.m3u8').read_text().splitlines():
            if line.startswith('#EXTINF:'):
                playlist.append(line)
            elif line.startswith('seg_'):
                playlist.append(f'g{i}/{line}')
        print(f'GENERATION {i} OFFSET {offset}', flush=True)
    playlist.append('#EXT-X-ENDLIST')
    merged = root / 'index.m3u8'; merged.write_text('\n'.join(playlist) + '\n')
    result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'warning', '-xerror', '-i', str(merged),
                             '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'],
                            capture_output=True, text=True, timeout=60)
    if result.returncode or result.stderr.strip():
        raise RuntimeError(result.stderr or 'decode failed')
    print('BLOFY_SYNTHETIC_CONTINUITY_PASS')


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='blofy-continuity-qa-') as tmp:
        root = Path(tmp); source = root / 'synthetic.mp4'
        run('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
            '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000', '-t', '12',
            '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-g', '50',
            '-keyint_min', '50', '-sc_threshold', '0', '-c:a', 'aac', str(source))
        verify(source, root)
