"""Classify every crash identity; never confuse a buffer header with a record.

The verifier requests raw logcat. Known metadata prefixes are also accepted for
regression evidence. A customer subprocess is still the customer's application.
Unattributed target mentions are rejected rather than silently discarded.
"""
import re

PACKAGE = 'tv.blofy.player.v2'
_THREADTIME = re.compile(r'^\s*(?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+[VDIWEFAS]\s+[^:]*:\s?')
_BRIEF = re.compile(r'^\s*[VDIWEFAS]/[^()]+\(\s*\d+\):\s?')
_NAME = r'[A-Za-z0-9_.]+(?::[A-Za-z0-9_.-]+)?'
_IDENTITY = re.compile(r'^(?:Process:\s*(' + _NAME + r')(?=,|\s|$)|Cmdline:\s*(' + _NAME + r')\s*$|.*?>>>\s*(' + _NAME + r')\s*<<<)')
_BOUNDARY = re.compile(r'^(?:FATAL EXCEPTION:|\*\*\* \*\*\*|Process:|Cmdline:|.*?>>>|--------- beginning of crash)')


def target_crashes_after_test(output: str) -> list[str]:
    """Return blocking records, without exposing them to the public log."""
    records: list[list[str]] = [[]]
    for raw in output.splitlines():
        line = _BRIEF.sub('', _THREADTIME.sub('', raw)).strip()
        if _BOUNDARY.match(line) and records[-1]:
            records.append([])
        records[-1].append(line)
    blocked = []
    for record in records:
        names = []
        for line in record:
            match = _IDENTITY.match(line)
            if match:
                names.extend(name for name in match.groups() if name)
        text = '\n'.join(record)
        if any(name == PACKAGE or name.startswith(PACKAGE + ':') for name in names):
            blocked.append(text)
        elif not names and PACKAGE in text:
            blocked.append(text)
    return blocked
