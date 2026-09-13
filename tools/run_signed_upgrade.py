#!/usr/bin/env python3
"""Verify an in-place production-signature upgrade only on a network-blocked CI emulator."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import zipfile
from run_r8_instrumentation import command, completed_cases, partition_test_dex

PACKAGE = 'tv.blofy.player.v2'
CERT = 'c3b98cccd2f0c86809014acd9368bf61c7004cfd419cd867b71fef10bfa6255e'


def one_pass(output, class_name, test_name):
    return (completed_cases(output) == [{'class':class_name,'test':test_name,'status':0}]
            and re.search(r'^INSTRUMENTATION_CODE: -1\s*$', output, re.M) is not None
            and 'INSTRUMENTATION_FAILED' not in output and 'Process crashed' not in output)


def main():
    assert os.environ['GITHUB_REF'] == 'refs/heads/rc07-runtime-recovery'
    assert os.environ['GITHUB_EVENT_NAME'] in {'push', 'workflow_dispatch'}
    sdk = Path(os.environ['ANDROID_HOME'])
    tools = sdk / ('build-tools/' + os.environ['ANDROID_BUILD_TOOLS_VERSION'])
    def adb(*args, timeout=90):
        return command(sdk/'platform-tools/adb', '-s', 'emulator-5554', *args, timeout=timeout)
    assert adb('shell','getprop','ro.kernel.qemu').strip() == '1', 'CI emulator required'
    adb('root'); adb('wait-for-device')
    assert adb('shell','id','-u').strip() == '0', 'Rooted emulator required for network isolation'
    old = Path(os.environ['RUNNER_TEMP'])/'blofy-upgrade-old.apk'
    new = Path('app/build/outputs/apk/release/app-release.apk')
    key = Path(os.environ['BLOFY_RELEASE_KEYSTORE_PATH'])
    assert key == Path(os.environ['RUNNER_TEMP'])/'blofy-production.keystore'
    assert hashlib.sha256(old.read_bytes()).hexdigest() == 'ded52c0abc0408e592feed82b5bafd214f4de9f1ad083b003330eab9f721dd58'
    new_hash = hashlib.sha256(new.read_bytes()).hexdigest()
    def certificate(path):
        output = command(tools/'apksigner','verify','--print-certs',path)
        return re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)',output)[1].lower()
    assert certificate(old) == certificate(new) == CERT
    tests = list(Path('app/build/outputs/apk/androidTest/release').glob('*.apk'))
    assert len(tests) == 1
    with tempfile.TemporaryDirectory(prefix='blofy-signed-upgrade-',dir=os.environ['RUNNER_TEMP']) as temp:
        temp = Path(temp)
        unsigned, aligned, ready = [temp/n for n in ['test-unsigned.apk','test-aligned.apk','test-ready.apk']]
        with zipfile.ZipFile(tests[0]) as source, zipfile.ZipFile(unsigned,'w') as target:
            names=[n for n in source.namelist() if re.fullmatch(r'classes(?:[0-9]+)?\.dex',n)]
            evidence=[p.read_bytes() for p in sorted(Path('build/r8-review/private/test-l8').rglob('*.dex'))]
            removed, retained=partition_test_dex([(n,source.read(n)) for n in names], evidence)
            for info in source.infolist():
                if info.filename in names: continue
                if re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))', info.filename,re.I): continue
                target.writestr(info,source.read(info.filename))
            for i,(_,data) in enumerate(retained,1):
                target.writestr('classes'+(str(i) if i>1 else '')+'.dex',data)
        command(tools/'zipalign','-f','-P','16','4',unsigned,aligned)
        command(tools/'apksigner','sign','--ks',key,'--ks-key-alias',os.environ['BLOFY_RELEASE_KEY_ALIAS'],
                '--ks-pass','env:BLOFY_RELEASE_STORE_PASSWORD','--key-pass','env:BLOFY_RELEASE_KEY_PASSWORD','--out',ready,aligned)
        assert certificate(ready) == CERT
        with zipfile.ZipFile(ready) as checked:
            for i,(_,data) in enumerate(retained,1):
                assert checked.read('classes'+(str(i) if i>1 else '')+'.dex') == data
        assert 'package:'+PACKAGE not in adb('shell','pm','list','packages',PACKAGE).splitlines(), 'Unexpected preinstalled app'
        assert 'Success' in adb('install','--no-incremental',old)
        def uid():
            return re.search(r'^package:'+re.escape(PACKAGE)+r' uid:(\d+)\s*$',adb('shell','pm','list','packages','-U',PACKAGE),re.M)[1]
        original_uid=uid()
        # Install never launches the app. Apply and verify both rules before first launch.
        for binary in ['iptables','ip6tables']:
            adb('shell',binary,'-I','OUTPUT','1','-m','owner','--uid-owner',original_uid,'-j','REJECT')
            adb('shell',binary,'-C','OUTPUT','-m','owner','--uid-owner',original_uid,'-j','REJECT')
        assert 'Success' in adb('install','--no-incremental','-t',ready)
        def launch():
            component=adb('shell','cmd','package','resolve-activity','--brief',PACKAGE).strip().splitlines()[-1]
            assert component.startswith(PACKAGE+'/')
            result=adb('shell','am','start','-W','-n',component)
            assert 'Status: ok' in result, 'Login did not launch'
        def instrument(cls,test):
            output=adb('shell','am','instrument','-w','-r','-e','signedUpgradeReview','true','-e','class',cls,
                       PACKAGE+'.test/androidx.test.runner.AndroidJUnitRunner',timeout=180)
            if not one_pass(output,cls,test):
                print(output[-12000:])  # Only generated offline fixtures.
                raise AssertionError('Signed upgrade runtime case failed')
        adb('logcat','-b','crash','-c')
        launch()
        # Bounded wait for the actual old Login to create its database and identity.
        for _ in range(30):
            ready_db=adb('shell','test -s /data/user/0/'+PACKAGE+'/databases/blofy-player-2.db && echo ready || echo waiting')
            if ready_db.strip() == 'ready': break
            time.sleep(1)
        assert ready_db.strip() == 'ready', 'Old Login did not initialize its database'
        instrument('tv.blofy.player.security.SignedUpgradeSeedTest','seedOldReleaseData')
        adb('shell','am','force-stop',PACKAGE)
        installed=adb('shell','dumpsys','package',PACKAGE)
        first=re.search(r'firstInstallTime=(.+)',installed)[1]
        assert 'Success' in adb('install','--no-incremental','-r',new), 'In-place signed upgrade rejected'
        assert uid()==original_uid
        after=adb('shell','dumpsys','package',PACKAGE)
        assert re.search(r'firstInstallTime=(.+)',after)[1]==first
        assert re.search(r'versionCode=2000054\b',after)
        for binary in ['iptables','ip6tables']:
            adb('shell',binary,'-C','OUTPUT','-m','owner','--uid-owner',original_uid,'-j','REJECT')
        instrument('tv.blofy.player.security.SignedUpgradeVerifyTest','upgradedReleaseReadsExistingEncryptedData')
        launch()
        assert adb('shell','pidof',PACKAGE).strip()
        crashes=adb('logcat','-b','crash','-d')
        assert PACKAGE not in crashes, 'Target process crash recorded'
        assert hashlib.sha256(new.read_bytes()).hexdigest()==new_hash
        report={'commit':os.environ['GITHUB_SHA'],'old_version_code':2000053,'new_version_code':2000054,
                'certificate_sha256':CERT,'apk_sha256':new_hash,'android_api':35,'abi':'x86_64',
                'in_place_upgrade':True,'same_uid_and_first_install_time':True,
                'identity_pin_encrypted_playlist_favorite_lock_resume_retained':True,
                'new_application_decrypts_old_keystore_credentials':True,'login_launch_passed':True,
                'app_network_blocked_ipv4_ipv6_before_first_launch':True,'no_app_uninstall_or_clear':True,
                'seed_and_verify_cases_passed_without_skips':True,'retained_test_dex_unchanged':True,
                'removed_dex_match_test_L8_producer':removed,
                'limits':'Offline emulator only. Physical receiver and provider playback still need owner testing.'}
        Path('release/upgrade-verification.json').write_text(json.dumps(report,indent=2))
        print(json.dumps(report,indent=2))


if __name__=='__main__': main()
