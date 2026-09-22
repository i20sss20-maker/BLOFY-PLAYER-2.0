#!/usr/bin/env bash
set -euo pipefail
bash tools/verify_rc0755_artwork.sh
adb shell am force-stop tv.blofy.player.v2
adb logcat -c
collect_startup() {
  adb pull /sdcard/Android/data/tv.blofy.player.v2/files/artwork-qa artwork-evidence/ || true
  adb logcat -b crash -d > artwork-evidence/startup-crashes.txt || true
  adb logcat -d -t 2500 > artwork-evidence/startup-logcat.txt || true
  adb shell dumpsys meminfo tv.blofy.player.v2 > artwork-evidence/startup-memory.txt || true
  adb shell dumpsys gfxinfo tv.blofy.player.v2 > artwork-evidence/startup-frames.txt || true
}
trap collect_startup EXIT
adb shell perfetto -o /data/misc/perfetto-traces/blofy-startup.pftrace -t 15s sched freq idle am wm gfx view binder_driver > artwork-evidence/perfetto-capture.txt 2>&1 &
trace_pid=$!
adb shell am instrument -w -r -e class 'tv.blofy.player.ui.StartupRecoveryDeviceTest#loginDrawsWhileIdentityStorageIsBlocked' \
  tv.blofy.player.v2.test/androidx.test.runner.AndroidJUnitRunner | tee artwork-evidence/startup.txt
grep -Fq 'OK (1 test)' artwork-evidence/startup.txt
if grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|Process crashed|INSTRUMENTATION_STATUS_CODE: -[1234]' artwork-evidence/startup.txt; then exit 1; fi
wait "$trace_pid" || true
adb pull /data/misc/perfetto-traces/blofy-startup.pftrace artwork-evidence/ || true
adb shell am instrument -w -r -e class 'tv.blofy.player.ui.LibraryDownloadDeviceTest#statusShowsSavedMissingAndFailedWithoutStartingAProviderRefresh' \
  tv.blofy.player.v2.test/androidx.test.runner.AndroidJUnitRunner | tee artwork-evidence/library-download-status.txt
grep -Fq 'OK (1 test)' artwork-evidence/library-download-status.txt
if grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|Process crashed|INSTRUMENTATION_STATUS_CODE: -[1234]' artwork-evidence/library-download-status.txt; then exit 1; fi
collect_startup
trap - EXIT
test -f artwork-evidence/artwork-qa/login-storage-blocked.png
test -f artwork-evidence/artwork-qa/startup-blocked-result.txt
if grep -q 'FATAL EXCEPTION' artwork-evidence/startup-crashes.txt; then exit 1; fi
