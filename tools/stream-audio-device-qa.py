#!/usr/bin/env python3
"""Read-only Android 9 audio QA. Requires exactly one owner-authorized ADB device.
Output is allowlisted: NO raw logcat, serial, source URLs, accounts or credentials.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

PACKAGES = ("tv.blofy.player.v2.stream.qa", "tv.blofy.player.v2.stream")
STATES = frozenset({
    "NOT_YET_DISCOVERED", "NO_AUDIO_TRACK", "UNSUPPORTED_AUDIO_CODEC",
    "SUPPORTED_NOT_SELECTED", "PLAYER_VOLUME_MUTED", "AUDIO_TRACK_SELECTED"
})
AUDIO_PATTERN = re.compile(
    r"\bBLOFY_AUDIO_HEALTH\s*:\s*state=([A-Z_]+);available=(\d+);"
    r"supported=(\d+);selected=(\d+);mime=(audio/[A-Za-z0-9._+\-]{1,40}|none)(?=\s|$)"
)
RECOVERY_PATTERN = re.compile(
    r"\bBLOFY_AUDIO_RECOVERY\s*:\s*supported_audio_selected_once\b"
)
VERSION_PATTERN = re.compile(r"\bversionName=([A-Za-z0-9._\-]{1,70})")
CODE_PATTERN = re.compile(r"\bversionCode=(\d{1,12})\b")


def parse_audio_lines(lines: str):
    """Discard all content except strictly validated structured audio observations."""
    observations, recoveries = [], 0
    for line in lines.splitlines():
        if RECOVERY_PATTERN.search(line):
            recoveries += 1
        match = AUDIO_PATTERN.search(line)
        if not match or match.group(1) not in STATES:
            continue
        available, supported, selected = map(int, match.group(2, 3, 4))
        if any(n > 100 for n in (available, supported, selected)):
            continue
        if supported > available or selected > supported:
            continue
        event = {
            "state": match.group(1), "available": available,
            "supported": supported, "selected": selected, "mime": match.group(5)
        }
        if not observations or observations[-1] != event:
            observations.append(event)
    return observations[-50:], min(recoveries, 10000)


def run(args, timeout=12):
    try:
        completed = subprocess.run(
            args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=True, timeout=timeout
        )
        return completed.stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
        # Do not print subprocess output: ADB errors can contain identifying data.
        raise RuntimeError("ADB command failed. Check platform-tools and TV access.") from err


def read_data():
    devices = run(["adb", "devices"])
    connected = re.findall(r"^([^\s]+)\s+device\s*$", devices, re.MULTILINE)
    if len(connected) != 1:
        raise RuntimeError("Connect exactly one authorized Android TV test device.")
    cmd = ["adb", "-s", connected[0]]
    sdk = run(cmd + ["shell", "getprop", "ro.build.version.sdk"]).strip()
    release = run(cmd + ["shell", "getprop", "ro.build.version.release"]).strip()
    if not sdk.isdigit() or not re.fullmatch(r"[0-9.]{1,20}", release):
        raise RuntimeError("Invalid device Android version metadata.")
    package_info = None
    for package in PACKAGES:
        listing = run(cmd + ["shell", "dumpsys", "package", package])
        name, version = VERSION_PATTERN.search(listing), CODE_PATTERN.search(listing)
        if name and version:
            package_info = {
                "package": package, "version": name.group(1),
                "versionCode": int(version.group(1))
            }
            break
    if package_info is None:
        raise RuntimeError("BLOFY STREAM QA or official application is not installed.")
    logs = run(cmd + ["logcat", "-d", "-v", "brief", "-s",
                      "BLOFY_AUDIO_HEALTH:I", "BLOFY_AUDIO_RECOVERY:I", "*:S"], 25)
    observations, recoveries = parse_audio_lines(logs)
    return {
        "scope": "One local Android device, audio-track metadata only",
        "androidSdk": int(sdk), "androidRelease": release,
        **package_info, "audioTrackObservations": observations,
        "recoverySelections": recoveries,
        "videoDecodedVerified": False, "audibleAudioVerified": False,
        "note": "Listen to the TV. Track detection does not prove audible audio."
    }


def main():
    parser = argparse.ArgumentParser(description="Sanitized BLOFY STREAM Android TV audio QA")
    parser.add_argument("--out", type=Path, default=Path("blofy-stream-device-audio-qa.json"))
    args = parser.parse_args()
    try:
        report = read_data()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Wrote sanitized audio QA: " + str(args.out))
    print("Physical audible output is NOT automatically verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
