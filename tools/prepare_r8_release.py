#!/usr/bin/env python3
"""Verify obfuscation/native continuity and package private maintenance inputs."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile
import zipfile


def main():
    assert os.environ['GITHUB_REF']=='refs/heads/rc07-runtime-recovery'
    apk=Path('app/build/outputs/apk/release/app-release.apk')
    aab=Path('app/build/outputs/bundle/release/app-release.aab')
    mapping=Path('app/build/outputs/mapping/release/mapping.txt')
    old=Path(os.environ['RUNNER_TEMP'])/'blofy-upgrade-old.apk'
    pairs=re.findall(r'^(tv\.blofy\.player\.\S+) -> (\S+):$',mapping.read_text(),re.M)
    renamed=sum(a!=b for a,b in pairs)
    assert renamed>=20, 'R8 did not run'
    hashes={}
    with zipfile.ZipFile(apk) as current,zipfile.ZipFile(old) as previous,zipfile.ZipFile(aab) as bundle:
        assert not any(n.endswith(('mapping.txt','proguard.map')) for n in current.namelist()), 'APK contains mapping'
        assert bundle.read('BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map') == mapping.read_bytes()
        for abi in ['arm64-v8a','armeabi-v7a','x86','x86_64']:
            name=f'lib/{abi}/libffmpegJNI.so'
            data=current.read(name)
            assert data==previous.read(name), f'Production FFmpeg bytes changed for {abi}'
            hashes[abi]=hashlib.sha256(data).hexdigest()
    report={'commit':os.environ['GITHUB_SHA'],'version':'2.0.0-rc07.43','version_code':2000054,
            'renamed_app_classes':renamed,'mapped_app_classes':len(pairs),
            'native_bytes_equal_released_rc0742':True,'native_sha256':hashes,
            'apk_sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),
            'aab_sha256':hashlib.sha256(aab.read_bytes()).hexdigest(),
            'maintenance_archive_requires_original_signing_private_key':True,
            'public_update_selection_changed':False}
    Path('release/release-protection.json').write_text(json.dumps(report,indent=2))
    archive=Path(os.environ['RUNNER_TEMP'])/'blofy-maintenance-private.tar.gz'
    with tarfile.open(archive,'w:gz') as target:
        target.add(aab,arcname='app-release.aab')
        target.add(mapping,arcname='mapping.txt')
        data=json.dumps(report,indent=2).encode()
        info=tarfile.TarInfo('source.json');info.size=len(data);info.mode=0o600
        target.addfile(info,io.BytesIO(data))
    archive.chmod(0o600)
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
