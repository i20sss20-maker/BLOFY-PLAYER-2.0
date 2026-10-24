#!/usr/bin/env python3
"""Guard the Google Play 2000073 baseline against TV navigation regressions."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
manifest = ET.parse(root / "app/src/play/AndroidManifest.xml").getroot()
ns = "{http://schemas.android.com/apk/res/android}"
activities = manifest.findall("application/activity")
registered = {a.attrib.get(ns + "name") for a in activities}
required = {
    ".ui.player.PlayerActivity",
    ".ui.player.VlcFallbackActivity",
    ".ui.settings.LibraryDownloadActivity",
    ".ui.search.SectionSearchActivity",
    ".ui.login.CatalogLoadingActivity",
    ".ui.home.HomeActivity",
    ".ui.login.SplashActivity",
}
missing = sorted(required - registered)
assert not missing, f"Google Play manifest misses reachable activities: {missing}"
assert all(a.attrib.get(ns + "exported") == "false" for a in activities
           if a.attrib.get(ns + "name") != ".ui.login.SplashActivity")
app = manifest.find("application")
assert app is not None and app.attrib.get(ns + "allowBackup") == "false"
assert manifest.find("uses-permission[@android:name='android.permission.REQUEST_INSTALL_PACKAGES']", {"android":"http://schemas.android.com/apk/res/android"}) is None, "Play must not request sideload permissions"
gradle = (root / "app/build.gradle.kts").read_text(encoding="utf-8")
assert re.search(r"versionCode\s*=\s*2000073\b", gradle), "Audit must keep Google Play 2000073 baseline"
print("PASS: Play 2000073 identity, TV routes, exported activities, backup and install policy")
