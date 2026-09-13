#!/usr/bin/env python3
"""Use the unchanged R8 app's L8 runtime instead of a conflicting test-APK copy.

This only repackages a disposable CI instrumentation APK. It never modifies or
publishes the target app, never disables an assertion, and requires all six cases.
Reference: https://slackhq.github.io/keeper/#core-library-desugaring-l8-support
"""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import zipfile

PACKAGE = 'tv.blofy.player.v2'
CLASS = 'tv.blofy.player.security.R8RuntimeContractTest'
EXPECTED = {
    'activationJsonNamesSurviveObfuscation', 'oldReleaseCacheJsonStillLoads',
    'roomGeneratedImplementationOpens', 'bundledFfmpegNativeLibraryLoads',
    'updateVerifierAndFileProviderRemainRestricted', 'loginActivityStartsWithoutProductionConnection'
}


def dex_classes(data):
    if len(data) < 112 or not re.fullmatch(rb'dex\n0[0-9]{2}\x00', data[:8]):
        raise ValueError('Unsupported DEX input')
    def table(offset, width):
        size, start = struct.unpack_from('<II', data, offset)
        if start + size * width > len(data):
            raise ValueError('DEX table outside input')
        return size, start
    ns, strings = table(56, 4)
    nt, types = table(64, 4)
    nc, classes = table(96, 32)
    result = set()
    for i in range(nc):
        type_id, = struct.unpack_from('<I', data, classes + 32*i)
        if type_id >= nt: raise ValueError('Invalid DEX class type')
        string_id, = struct.unpack_from('<I', data, types + 4*type_id)
        if string_id >= ns: raise ValueError('Invalid DEX descriptor')
        cursor, = struct.unpack_from('<I', data, strings + 4*string_id)
        for _ in range(5):
            if cursor >= len(data): raise ValueError('Invalid DEX string offset')
            value = data[cursor]; cursor += 1
            if value < 128: break
        else: raise ValueError('Invalid DEX string length')
        end = data.find(b'\0', cursor)
        if end < cursor: raise ValueError('Unterminated DEX string')
        descriptor = data[cursor:end].decode('utf-8')
        if not descriptor.startswith('L') or not descriptor.endswith(';'):
            raise ValueError('Invalid DEX class descriptor')
        result.add(descriptor)
    return result


def completed_cases(output):
    cases, current = [], {}
    for line in output.splitlines():
        if line.startswith('INSTRUMENTATION_STATUS: '):
            key, sep, value = line[len('INSTRUMENTATION_STATUS: '):].partition('=')
            if sep: current[key] = value
        elif line.startswith('INSTRUMENTATION_STATUS_CODE: '):
            status = int(line.partition(':')[2].strip())
            if status != 1 and 'test' in current:
                cases.append({'class': current.get('class'), 'test': current['test'], 'status': status})
            current = {}
    return cases


def all_passed(output, cases):
    return (len(cases) == 6 and {c['test'] for c in cases} == EXPECTED and
            all(c['class'] == CLASS and c['status'] == 0 for c in cases) and
            re.search(r'^INSTRUMENTATION_CODE: -1\s*$', output, re.M) is not None and
            'INSTRUMENTATION_FAILED' not in output and 'Process crashed' not in output)


def command(*args, timeout=90):
    result = subprocess.run([str(x) for x in args], text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError(Path(str(args[0])).name + ' failed: ' + result.stdout[-1200:])
    return result.stdout


def main():
    assert os.environ.get('GITHUB_REF') == 'refs/heads/security/r8-compatibility-review'
    key = Path(os.environ['BLOFY_RELEASE_KEYSTORE_PATH'])
    assert key.name == 'blofy-r8-review.p12' and key.parent == Path(os.environ['RUNNER_TEMP'])
    tools = Path(os.environ['ANDROID_HOME']) / 'build-tools/35.0.0'
    app = Path('app/build/outputs/apk/release/app-release.apk')
    tests = list(Path('app/build/outputs/apk/androidTest/release').glob('*.apk'))
    assert len(tests) == 1, 'Expected one test APK'
    original_hash = hashlib.sha256(app.read_bytes()).hexdigest()
    evidence = Path('build/r8-review/public/summary.json')
    summary = json.loads(evidence.read_text())
    assert summary['apk_sha256'] == original_hash
    assert f"package: name='{PACKAGE}'" in command(tools/'aapt', 'dump', 'badging', app)
    assert f"package: name='{PACKAGE}.test'" in command(tools/'aapt', 'dump', 'badging', tests[0])
    def certificate(path):
        output = command(tools/'apksigner', 'verify', '--print-certs', path)
        match = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)', output)
        assert match, 'Missing verified signing certificate'
        return match[1].lower()
    cert = certificate(app)
    assert cert != 'c3b98cccd2f0c86809014acd9368bf61c7004cfd419cd867b71fef10bfa6255e'
    with tempfile.TemporaryDirectory(prefix='blofy-r8-test-', dir=os.environ['RUNNER_TEMP']) as work:
        work = Path(work)
        unsigned, aligned, ready = [work / name for name in ['test-unsigned.apk','test-aligned.apk','test-ready.apk']]
        removed, retained = [], []
        with zipfile.ZipFile(tests[0]) as source, zipfile.ZipFile(unsigned, 'w') as output:
            dex_entries = sorted((n for n in source.namelist() if re.fullmatch(r'classes(?:[0-9]+)?\.dex', n)),
                                 key=lambda n: int(re.search(r'([0-9]+)', n)[1]) if re.search(r'([0-9]+)', n) else 1)
            for name in dex_entries:
                data = source.read(name); classes = dex_classes(data)
                backport = {c for c in classes if c.startswith('Lj$/')}
                if backport:
                    assert backport == classes, 'Mixed DEX cannot safely be removed'
                    removed.append({'entry': name, 'classes': len(classes)})
                else: retained.append((name, data))
            assert removed and retained, 'Expected isolated duplicate L8 DEX and retained tests'
            for info in source.infolist():
                if info.filename in dex_entries: continue
                if re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))', info.filename, re.I): continue
                output.writestr(info, source.read(info.filename))
            for i, (_, data) in enumerate(retained, 1):
                output.writestr('classes'+(str(i) if i>1 else '')+'.dex', data, compress_type=zipfile.ZIP_DEFLATED)
        # Only the test carrier is re-signed, using the disposable identity shared with its target.
        command(tools/'zipalign', '-f', '-P', '16', '4', unsigned, aligned)
        command(tools/'apksigner', 'sign', '--ks', key, '--ks-key-alias', os.environ['BLOFY_RELEASE_KEY_ALIAS'],
                '--ks-pass', 'env:BLOFY_RELEASE_STORE_PASSWORD', '--key-pass', 'env:BLOFY_RELEASE_KEY_PASSWORD',
                '--out', ready, aligned)
        assert certificate(ready) == cert
        with zipfile.ZipFile(ready) as checked:
            for i, (_, data) in enumerate(retained, 1):
                assert checked.read('classes'+(str(i) if i>1 else '')+'.dex') == data
        summary['instrumentation_harness'] = {'shared_L8_from_unchanged_app': True,
            'removed_test_only_backport_dex': removed, 'test_code_dex_unchanged': True}
        adb = Path(os.environ['ANDROID_HOME']) / 'platform-tools/adb'
        command(adb, '-s', 'emulator-5554', 'install', '--no-incremental', '-r', '-t', app)
        command(adb, '-s', 'emulator-5554', 'install', '--no-incremental', '-r', '-t', ready)
        output = command(adb, '-s', 'emulator-5554', 'shell', 'am', 'instrument', '-w', '-r',
                         '-e', 'r8Review', 'true', '-e', 'class', CLASS,
                         PACKAGE+'.test/androidx.test.runner.AndroidJUnitRunner', timeout=300)
        cases = completed_cases(output)
        summary['runtime_validation'] = {'android_api':35, 'abi':'x86_64', 'completed_cases':cases,
            'all_six_passed_without_skips':all_passed(output,cases)}
        assert hashlib.sha256(app.read_bytes()).hexdigest() == original_hash, 'Target APK changed'
        evidence.write_text(json.dumps(summary,indent=2))
        print(json.dumps(summary,indent=2))
        if not all_passed(output,cases):
            print(output[-10000:])  # Isolated test data only; never a customer/device account.
            raise AssertionError('All six unchanged runtime assertions must pass')


if __name__ == '__main__':
    main()
