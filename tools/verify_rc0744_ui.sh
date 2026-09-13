#!/usr/bin/env bash
set -euo pipefail
kind="$1"
mkdir -p ui-evidence
adb install --no-incremental app/build/outputs/apk/debug/app-debug.apk
adb install --no-incremental app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb logcat -c
classes=tv.blofy.player.ui.InterfaceRefinementTest
expected=3
if [[ "$kind" == tv ]]; then
  classes="$classes,tv.blofy.player.ui.CommercialUiRegressionTest"
  expected=6
fi
adb shell am instrument -w -r -e class "$classes" -e expected_kind "$kind" tv.blofy.player.v2.test/androidx.test.runner.AndroidJUnitRunner | tee ui-evidence/instrumentation.txt
adb pull /sdcard/Android/data/tv.blofy.player.v2/files/ui-refinement ui-evidence/ || true
adb pull /sdcard/Android/data/tv.blofy.player.v2/files/rc37-ui ui-evidence/ || true
adb logcat -b crash -d > ui-evidence/crashes.txt
grep -Fq "OK ($expected tests)" ui-evidence/instrumentation.txt
! grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|Process crashed|INSTRUMENTATION_STATUS_CODE: -[1234]' ui-evidence/instrumentation.txt
! grep -q 'FATAL EXCEPTION' ui-evidence/crashes.txt
test -f ui-evidence/ui-refinement/settings-cards.png
test -f ui-evidence/ui-refinement/trial-expired.png
test -f ui-evidence/ui-refinement/details-movie-cast.png
test -f ui-evidence/ui-refinement/details-series-cast.png

# Bounded synthetic-screen evidence is also readable through the Actions log API.
python3 - <<'PYSCREEN'
import base64,pathlib
for folder,names in [('ui-refinement',['settings-cards','trial-active','trial-expired','details-movie-cast']),('rc37-ui',['exit-stay'])]:
 for name in names:
  image=pathlib.Path('ui-evidence')/folder/(name+'.png')
  if image.is_file():
   data=image.read_bytes()
   assert len(data) < 2_000_000
   print('BLOFY_SCREEN '+name+' '+base64.b64encode(data).decode())
PYSCREEN
