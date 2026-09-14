#!/usr/bin/env python3
"""Summarize actual R8 output without publishing mapping or APKs. No secret scanning."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def main():
    root = Path.cwd()
    mapping = root / 'app/build/outputs/mapping/release/mapping.txt'
    pairs = []
    for line in mapping.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'(\S+) -> (\S+):', line)
        if match and match[1].startswith('tv.blofy.player.'):
            pairs.append(match.groups())
    renamed = sum(old != new for old, new in pairs)
    assert renamed >= 20, 'R8 did not rename a meaningful set of app classes'
    apk = root / 'app/build/outputs/apk/release/app-release.apk'
    before = Path(os.environ['RUNNER_TEMP']) / 'blofy-review-unobfuscated.apk'
    abi_hashes = {}
    with zipfile.ZipFile(apk) as current, zipfile.ZipFile(before) as baseline:
        for abi in ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']:
            path = f'lib/{abi}/libffmpegJNI.so'
            data = current.read(path)
            assert data == baseline.read(path), f'Native bytes changed for {abi}'
            abi_hashes[abi] = hashlib.sha256(data).hexdigest()
    results = []
    for path in (root / 'app/build/test-results/testDebugUnitTest').glob('*.xml'):
        document = ET.parse(path).getroot()
        results.append({k: int(document.get(k, '0')) for k in ['tests', 'failures', 'errors', 'skipped']})
    assert results and sum(row['tests'] for row in results) > 0, 'Missing JVM test results'
    assert not any(row['failures'] or row['errors'] for row in results), 'JVM tests failed'
    summary = {
        'commit': os.environ.get('GITHUB_SHA'), 'kind': 'isolated_R8_validation_not_customer_release',
        'production_signing_key_used': False, 'production_api_used': False,
        'mapped_app_classes': len(pairs), 'renamed_app_classes': renamed,
        'shrinking_enabled': False, 'optimization_enabled': False,
        'native_bytes_match_same_source_unobfuscated_build': True,
        'native_sha256': abi_hashes,
        'jvm_tests': {key: sum(row[key] for row in results) for key in results[0]},
        'apk_sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
        'runtime_validation': 'pending',
        'limits': 'No real provider playback, production-key upgrade, source privacy, or full-history audit is established.'
    }
    output = root / 'build/r8-review/public'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
