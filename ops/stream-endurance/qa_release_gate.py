#!/usr/bin/env python3
"""Fail-closed release gate over anonymized decoded-frame client telemetry.

No external requests. Checking claimed provenance does not authenticate the
collector; independently verify the device reports before production rollout.
"""
import argparse
import json
import math
from pathlib import Path


def p95(xs):
    return sorted(xs)[max(0, math.ceil(len(xs)*0.95)-1)] if xs else None


def nonnegative(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def check(report, min_group=3):
    if report.get('schemaVersion') != 1 or report.get('scope') != 'client_decoder':
        return {'go': False, 'reasons': ['missing_client_decoder_evidence'], 'cohorts': {}}
    sessions, required = report.get('sessions'), report.get('requiredCohorts')
    if not isinstance(sessions, list) or not isinstance(required, list) or not required:
        return {'go': False, 'reasons': ['missing_sessions_or_cohorts'], 'cohorts': {}}
    if len(sessions) > 10000 or not all(isinstance(s, dict) for s in sessions):
        return {'go': False, 'reasons': ['invalid_or_oversized_session_data'], 'cohorts': {}}
    if not all(isinstance(c, str) and '|' in c and len(c) <= 80 for c in required):
        return {'go': False, 'reasons': ['invalid_required_cohorts'], 'cohorts': {}}
    results, reasons = {}, []
    for cohort in sorted(set(required)):
        rows = [r for r in sessions if r.get('cohort') == cohort]
        valid = [r for r in rows if nonnegative(r.get('durationSeconds')) and
                 r['durationSeconds'] >= 300 and nonnegative(r.get('firstDecodedFrameMs'))]
        ttff = [r['firstDecodedFrameMs'] for r in valid if r['firstDecodedFrameMs'] <= 120000]
        missing_video = sum(not nonnegative(r.get('decodedVideoFrames')) or
                            r['decodedVideoFrames'] <= 0 for r in valid)
        silent_audio = sum(r.get('audioExpected', True) and
                           (not nonnegative(r.get('decodedAudioFrames')) or r['decodedAudioFrames'] <= 0)
                           for r in valid)
        invalid_gaps = any(not nonnegative(r.get('videoGapsOver3s')) or
                           not nonnegative(r.get('audioGapsOver3s')) for r in valid)
        gaps = sum(int(r['videoGapsOver3s'] + r['audioGapsOver3s']) for r in valid
                   if nonnegative(r.get('videoGapsOver3s')) and nonnegative(r.get('audioGapsOver3s')))
        injected = [r for r in valid if r.get('testOutageInjected') is True]
        recovered = [r['outageRecoveryMs'] for r in injected
                     if nonnegative(r.get('outageRecoveryMs'))]
        start_p95, recovery_p95 = p95(ttff), p95(recovered)
        accepted = (len(valid) >= min_group and len(ttff) == len(valid) and
                    not missing_video and not silent_audio and not gaps and not invalid_gaps
                    and start_p95 is not None and start_p95 <= 6000
                    and injected and len(recovered) == len(injected)
                    and recovery_p95 is not None and recovery_p95 <= 10000)
        results[cohort] = {
            'sampledSessions': len(valid),
            'ttffP95Ms': start_p95, 'missingVideo': missing_video,
            'silentAudio': silent_audio, 'over3sGaps': gaps,
            'controlledOutageTests': len(injected),
            'recoveryP95Ms': recovery_p95, 'pass': bool(accepted)}
        if not accepted:
            reasons.append('cohort_not_ready:'+cohort)
    return {'go': not reasons, 'reasons': reasons, 'cohorts': results,
            'caution': 'Aggregated device claims are not authenticated by this script.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--min-group', type=int, default=3)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if not 1 <= args.min_group <= 100:
        parser.error('min-group must be 1..100')
    result = check(json.loads(args.input.read_text()), args.min_group)
    rendered = json.dumps(result, indent=2)
    print(rendered)
    if args.report:
        args.report.write_text(rendered)
    return 0 if result['go'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
