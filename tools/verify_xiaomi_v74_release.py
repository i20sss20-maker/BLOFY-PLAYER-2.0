#!/usr/bin/env python3
"""Fail closed on BLOFY 74 Google TV regressions in the restored Xiaomi UI."""
from pathlib import Path
import re, struct

root = Path(__file__).resolve().parent.parent
gradle = (root / "app/build.gradle.kts").read_text()
assert 'applicationId = if (xiaomiEdition) "tv.blofy.player.xiaomi" else "tv.blofy.player.v2"' in gradle
assert 'versionCode = 2000080' in gradle, "Never reuse Play Console's removed/previous 2000074"
assert '"2.0.0-rc07.55.6"' in gradle
assert 'versionName = "2.0.0-rc07.55.6"' in gradle
assert 'rc07.55.6-xiaomi' not in gradle, 'Display version must remain BLOFY PLAYER without Xiaomi suffix'
for locale in ('values', 'values-ar', 'values-en'):
    resource = (root / 'app/src/main/res' / locale / 'strings.xml').read_text()
    assert '<string name="app_name">BLOFY PLAYER</string>' in resource, locale
assert 'BLOFY_XIAOMI_EDITION' in gradle
assert 'BLOFY_DISTRIBUTION' in gradle
for manifest_name in ("app/src/main/AndroidManifest.xml", "app/src/play/AndroidManifest.xml"):
    manifest = (root / manifest_name).read_text()
    assert 'android:banner="@drawable/blofy_tv_banner"' in manifest
    assert 'android:icon="@drawable/blofy_logo"' in manifest
    assert 'android.intent.category.LEANBACK_LAUNCHER' in manifest
    for activity in ("VlcFallbackActivity", "LibraryDownloadActivity", "SectionSearchActivity"):
        assert activity in manifest, activity
assert 'REQUEST_INSTALL_PACKAGES' not in (root / "app/src/play/AndroidManifest.xml").read_text()
for resource in ("app/src/main/res/drawable-xhdpi/blofy_tv_banner.png",
                 "app/src/main/res/drawable-nodpi/blofy_tv_banner.png"):
    blob = (root / resource).read_bytes()
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", blob[16:24]) == (320, 180), resource
logo = (root / "app/src/main/res/drawable-nodpi/blofy_logo.png").read_bytes()
assert struct.unpack(">II", logo[16:24]) == (512, 512)
assert not (root / "app/src/main/res/drawable/blofy_tv_banner.xml").exists()
login = (root / "app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt").read_text()
for edge in ("refreshCodeButton.nextFocusDownId = addPlaylist.id",
             "privacyButton.nextFocusDownId = connectButton.id",
             "addPlaylist.nextFocusUpId = refreshCodeButton.id",
             "connectButton.nextFocusUpId = privacyButton.id"):
    assert edge in login, edge
print("PASS: preserved v74 UI, branded 320x180 banner, 512x512 icon, bidirectional D-pad, Play manifest, package identity")
