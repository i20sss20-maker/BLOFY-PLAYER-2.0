#!/usr/bin/env python3
"""Exercise the signed Play AAB's generated splits on an isolated 16 KB emulator."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile
from audit_published_apk import audit
from probe_android_page_size import probe_android_page_size
from run_r8_instrumentation import command, completed_cases, partition_test_dex

PACKAGE='tv.blofy.player.v2'
CERT='c3b98cccd2f0c86809014acd9368bf61c7004cfd419cd867b71fef10bfa6255e'
def main():
    assert os.environ['GITHUB_REF']=='refs/heads/rc07-runtime-recovery'
    sdk=Path(os.environ['ANDROID_HOME']); build=sdk/('build-tools/'+os.environ['ANDROID_BUILD_TOOLS_VERSION'])
    run=Path(os.environ['RUNNER_TEMP']); output=Path('play-upload');output.mkdir(exist_ok=True)
    def adb(*args,timeout=120): return command(sdk/'platform-tools/adb','-s','emulator-5554',*args,timeout=timeout)
    assert adb('shell','getprop','ro.kernel.qemu').strip()=='1'
    page_size=probe_android_page_size(adb,command,sdk=sdk,ndk_version=os.environ['ANDROID_NDK_VERSION'],run=run)
    adb('root');adb('wait-for-device');assert adb('shell','id','-u').strip()=='0'
    assert 'package:'+PACKAGE not in adb('shell','pm','list','packages',PACKAGE).splitlines()
    checks=[]
    with tempfile.TemporaryDirectory(dir=run,prefix='play-review-') as temp:
        temp=Path(temp)
        with zipfile.ZipFile(run/'blofy-play.apks') as archive:
            for info in archive.infolist():
                if not info.filename.endswith('.apk'): continue
                path=temp/Path(info.filename).name;path.write_bytes(archive.read(info))
                data=audit(path);checks.append({'split':info.filename,**data})
                assert all(row['elf_16kb'] and row['zip_16kb'] is not False for row in data['libraries'])
                signature=command(build/'apksigner','verify','--print-certs',path)
                assert re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)',signature)[1].lower()==CERT
                command(build/'zipalign','-c','-P','16','4',path)
        assert any(check['libraries'] for check in checks),'No native split inspected'
        command('java','-jar',run/'bundletool.jar','install-apks','--apks='+str(run/'blofy-play.apks'),'--adb='+str(sdk/'platform-tools/adb'),'--device-id=emulator-5554',timeout=180)
        uid=re.search(r'uid:(\d+)',adb('shell','pm','list','packages','-U',PACKAGE))[1]
        for binary in ['iptables','ip6tables']:
            adb('shell',binary,'-I','OUTPUT','1','-m','owner','--uid-owner',uid,'-j','REJECT')
            adb('shell',binary,'-C','OUTPUT','-m','owner','--uid-owner',uid,'-j','REJECT')
        tests=list(Path('app/build/outputs/apk/androidTest/release').glob('*.apk'));assert len(tests)==1
        unsigned,aligned,ready=[temp/name for name in ['test-unsigned.apk','test-aligned.apk','test-ready.apk']]
        with zipfile.ZipFile(tests[0]) as source,zipfile.ZipFile(unsigned,'w') as target:
            names=[name for name in source.namelist() if re.fullmatch(r'classes(?:[0-9]+)?\.dex',name)]
            evidence=[p.read_bytes() for p in sorted(Path('build/r8-review/private/test-l8').rglob('*.dex'))]
            removed,retained=partition_test_dex([(name,source.read(name)) for name in names],evidence)
            for info in source.infolist():
                if info.filename in names or re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))',info.filename,re.I): continue
                target.writestr(info,source.read(info.filename))
            for i,(_,data) in enumerate(retained,1): target.writestr('classes'+(str(i) if i>1 else '')+'.dex',data)
        command(build/'zipalign','-f','-P','16','4',unsigned,aligned)
        command(build/'apksigner','sign','--ks',os.environ['BLOFY_RELEASE_KEYSTORE_PATH'],'--ks-key-alias',os.environ['BLOFY_RELEASE_KEY_ALIAS'],
            '--ks-pass','env:BLOFY_RELEASE_STORE_PASSWORD','--key-pass','env:BLOFY_RELEASE_KEY_PASSWORD','--out',ready,aligned)
        adb('install','--no-incremental','-t',ready)
        adb('logcat','-b','crash','-c')
        result=adb('shell','am','instrument','-w','-r','-e','playBundleReview','true','-e','class',
            'tv.blofy.player.security.PlayBundleSmokeTest',PACKAGE+'.test/androidx.test.runner.AndroidJUnitRunner',timeout=240)
        cases=completed_cases(result)
        expected={'installerAbsentAndOriginalFfmpegLoads','androidKeystoreAndRoomStoreOnlyEncryptedCredentials','loginAndPrivacyOpenWithNetworkBlocked'}
        assert len(cases)==3 and {case['test'] for case in cases}==expected and all(
            case['status']==0 and case['class']=='tv.blofy.player.security.PlayBundleSmokeTest' for case in cases),result[-12000:]
        assert re.search(r'^INSTRUMENTATION_CODE: -1\s*$',result,re.M)
        assert PACKAGE not in adb('logcat','-b','crash','-d')
        report={'commit':os.environ['GITHUB_SHA'],'page_size':page_size,'page_size_probe':'android-bionic-native','api':35,'abi':'x86_64',
            'aab_sha256':hashlib.sha256((output/'BLOFY-PLAYER-rc07.46-play.aab').read_bytes()).hexdigest(),
            'split_signatures_verified':True,'original_ffmpeg_loaded':True,'encrypted_room_roundtrip':True,
            'installer_permission_absent':True,'network_blocked_before_first_launch':True,'tests':cases,
            'limits':'CI emulator and generated bundletool splits; Play Console pre-launch and physical devices remain separate gates.'}
        (output/'play-bundle-verification.json').write_text(json.dumps(report,indent=2))
        (output/'play-split-alignment.json').write_text(json.dumps(checks,indent=2))
        print(json.dumps(report,indent=2))

if __name__=='__main__': main()
