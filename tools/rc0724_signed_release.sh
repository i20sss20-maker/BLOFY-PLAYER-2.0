#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_KEYSTORE_BASE64:?missing}"
: "${ANDROID_KEYSTORE_PASSWORD:?missing}"
: "${ANDROID_KEY_ALIAS:?missing}"
: "${ANDROID_KEY_PASSWORD:?missing}"

EXPECTED_CERT_SHA256="C3B98CCCD2F0C86809014ACD9368BF61C7004CFD419CD867B71FEF10BFA6255E"
PRODUCTION_ACTIVATION_BASE_URL="https://blofy-player-2-0.vercel.app"
MEDIA3_VERSION="1.6.1"
ANDROID_NDK_VERSION="28.0.13004108"
ANDROID_CMAKE_VERSION="3.22.1"
ANDROID_BUILD_TOOLS_VERSION="35.0.0"

# Exact release identity.
grep -Fq 'versionCode = 2000032' app/build.gradle.kts
grep -Fq 'versionName = "2.0.0-rc07.24"' app/build.gradle.kts
grep -Fq 'applicationId = "tv.blofy.player.v2"' app/build.gradle.kts

sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$sdkmanager" --licenses >/dev/null || true
"$sdkmanager" "platforms;android-36" "build-tools;$ANDROID_BUILD_TOOLS_VERSION" "ndk;$ANDROID_NDK_VERSION" "cmake;$ANDROID_CMAKE_VERSION"
command -v ninja >/dev/null 2>&1 || { sudo apt-get update && sudo apt-get install -y ninja-build; }

umask 077
keystore="$RUNNER_TEMP/blofy-production.keystore"
clean_b64="$RUNNER_TEMP/blofy-production.b64"
printf '%s' "$ANDROID_KEYSTORE_BASE64" | tr -cd 'A-Za-z0-9+/=' > "$clean_b64"
remainder=$(( $(wc -c < "$clean_b64") % 4 ))
if [[ "$remainder" -ne 0 ]]; then printf '%*s' $((4 - remainder)) '' | tr ' ' '=' >> "$clean_b64"; fi
base64 --decode "$clean_b64" > "$keystore"
actual="$(keytool -exportcert -keystore "$keystore" -storepass:env ANDROID_KEYSTORE_PASSWORD -alias "$ANDROID_KEY_ALIAS" | sha256sum | awk '{print toupper($1)}')"
[[ "$actual" == "$EXPECTED_CERT_SHA256" ]]

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 20 "$PRODUCTION_ACTIVATION_BASE_URL/health" > "$RUNNER_TEMP/health.json"
python3 - "$RUNNER_TEMP/health.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
assert p.get('ok') is True and p.get('database')=='ready' and p.get('playlistEncryption')=='ready'
PY

export NDK_PATH="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"
export PATH="$ANDROID_HOME/cmake/$ANDROID_CMAKE_VERSION/bin:$PATH"
export ENABLED_DECODERS="ac3 eac3 dca truehd aac mp3 opus vorbis flac"
chmod +x tools/build_media3_ffmpeg.sh
tools/build_media3_ffmpeg.sh
aar="$GITHUB_WORKSPACE/build/ffmpeg-native/media3-decoder-ffmpeg-$MEDIA3_VERSION.aar"
test -s "$aar"
sha256sum --check "$aar.sha256"

export BLOFY_RELEASE_KEYSTORE_PATH="$keystore"
export BLOFY_RELEASE_STORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
export BLOFY_RELEASE_KEY_ALIAS="$ANDROID_KEY_ALIAS"
export BLOFY_RELEASE_KEY_PASSWORD="$ANDROID_KEY_PASSWORD"
export GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx2048m"

gradle --no-daemon --max-workers=2 -PBLOFY_ACTIVATION_BASE_URL="$PRODUCTION_ACTIVATION_BASE_URL" -PBLOFY_BUILD_SHA="$GITHUB_SHA" -PBLOFY_FFMPEG_AAR="$aar" testDebugUnitTest
gradle --no-daemon --max-workers=2 -PBLOFY_ACTIVATION_BASE_URL="$PRODUCTION_ACTIVATION_BASE_URL" -PBLOFY_BUILD_SHA="$GITHUB_SHA" -PBLOFY_FFMPEG_AAR="$aar" lintRelease
gradle --no-daemon --max-workers=2 -PBLOFY_ACTIVATION_BASE_URL="$PRODUCTION_ACTIVATION_BASE_URL" -PBLOFY_BUILD_SHA="$GITHUB_SHA" -PBLOFY_FFMPEG_AAR="$aar" assembleRelease bundleRelease

mkdir -p release
cp app/build/outputs/apk/release/app-release.apk release/BLOFY-PLAYER-2.0-rc07.24-signed.apk
cp app/build/outputs/bundle/release/app-release.aab release/BLOFY-PLAYER-2.0-rc07.24-signed.aab
tools="$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION"
apk="release/BLOFY-PLAYER-2.0-rc07.24-signed.apk"
"$tools/aapt" dump badging "$apk" | tee release/apk-badging.txt
grep -Fq "package: name='tv.blofy.player.v2' versionCode='2000032' versionName='2.0.0-rc07.24'" release/apk-badging.txt
"$tools/zipalign" -c -P 16 -v 4 "$apk"
"$tools/apksigner" verify --verbose --print-certs "$apk" | tee release/apk-signature.txt
actual="$("$tools/apksigner" verify --print-certs "$apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n1 | tr -d '[:space:]-:' | tr '[:lower:]' '[:upper:]')"
[[ "$actual" == "$EXPECTED_CERT_SHA256" ]]
jarsigner -verify -certs release/BLOFY-PLAYER-2.0-rc07.24-signed.aab | tee release/aab-signature.txt
unzip -Z1 "$apk" > "$RUNNER_TEMP/apk-files.txt"
for abi in arm64-v8a armeabi-v7a x86 x86_64; do grep -Eiq "^lib/$abi/lib(ffmpeg|ffmpegJNI).*\.so$" "$RUNNER_TEMP/apk-files.txt"; done
(cd release && sha256sum BLOFY-PLAYER-2.0-rc07.24-signed.apk BLOFY-PLAYER-2.0-rc07.24-signed.aab > SHA256SUMS && sha256sum --check SHA256SUMS)

rm -f "$keystore" "$clean_b64"
