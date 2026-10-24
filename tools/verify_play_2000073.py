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
# TV form-factor declarations are necessary (but not sufficient) for Play TV discovery.
app = manifest.find("application")
features = {e.attrib.get(ns + "name"): e.attrib.get(ns + "required") for e in manifest.findall("uses-feature")}
assert features.get("android.software.leanback") == "false", "TV compatibility declaration missing"
assert features.get("android.hardware.touchscreen") == "false", "TV must not require touch input"
assert app is not None and app.attrib.get(ns + "banner"), "Android TV app banner missing"
splash = next(a for a in activities if a.attrib.get(ns + "name") == ".ui.login.SplashActivity")
categories = {node.attrib.get(ns + "name") for filt in splash.findall("intent-filter") for node in filt.findall("category")}
assert "android.intent.category.LEANBACK_LAUNCHER" in categories, "TV launcher entry missing"
assert all(a.attrib.get(ns + "exported") == "false" for a in activities
           if a.attrib.get(ns + "name") != ".ui.login.SplashActivity")
app = manifest.find("application")
assert app is not None and app.attrib.get(ns + "allowBackup") == "false"
assert manifest.find("uses-permission[@android:name='android.permission.REQUEST_INSTALL_PACKAGES']", {"android":"http://schemas.android.com/apk/res/android"}) is None, "Play must not request sideload permissions"
gradle = (root / "app/build.gradle.kts").read_text(encoding="utf-8")
assert re.search(r"versionCode\s*=\s*2000073\b", gradle), "Audit must keep Google Play 2000073 baseline"

# Check every activity targeted by a statically typed intent, including TV fallbacks.
# The own-APK updater is deliberately absent from Google Play; it routes to Play Store.
targets = set()
for source in (root / "app/src/main/java").rglob("*.kt"):
    code = source.read_text(encoding="utf-8")
    targets.update(re.findall(r"\b([A-Z]\w*Activity)\s*::\s*class\.java\b", code))
registered_short = {name.rsplit(".", 1)[-1] for name in registered}
exempt = {"AppUpdateActivity"}
missing_routes = sorted(targets - registered_short - exempt)
assert not missing_routes, f"Google Play manifest omits statically referenced activities: {missing_routes}"
print(f"PASS: Play 2000073 identity, {len(targets)} referenced Activity routes, non-exported screens, backup and install policy")
