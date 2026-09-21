#!/usr/bin/env bash
set -euo pipefail
mkdir -p artwork-evidence
adb install --no-incremental app/build/outputs/apk/debug/app-debug.apk
adb install --no-incremental app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb logcat -c
collect_evidence() {
  adb pull /sdcard/Android/data/tv.blofy.player.v2/files/artwork-qa artwork-evidence/ || true
  adb logcat -b crash -d > artwork-evidence/crashes.txt || true
}
trap collect_evidence EXIT
for method in seedFavoritesAndDurableArtwork resumeMissingArtworkAfterProcessRestart reopenFavoritesOfflineAfterProcessRestart; do
  adb shell am instrument -w -r -e class "tv.blofy.player.ui.ArtworkFavoritesDeviceTest#$method" \
    tv.blofy.player.v2.test/androidx.test.runner.AndroidJUnitRunner | tee "artwork-evidence/$method.txt"
  grep -Fq 'OK (1 test)' "artwork-evidence/$method.txt"
  if grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|Process crashed|INSTRUMENTATION_STATUS_CODE: -[1234]' "artwork-evidence/$method.txt"; then exit 1; fi
  adb shell am force-stop tv.blofy.player.v2
done
collect_evidence
trap - EXIT
if grep -q 'FATAL EXCEPTION' artwork-evidence/crashes.txt; then exit 1; fi
test -f artwork-evidence/artwork-qa/favorites-offline-first.png
test -f artwork-evidence/artwork-qa/favorites-offline-last.png
