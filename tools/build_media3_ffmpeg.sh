#!/usr/bin/env bash
set -euo pipefail

MEDIA3_VERSION="${MEDIA3_VERSION:-1.6.1}"
FFMPEG_VERSION="${FFMPEG_VERSION:-n6.0}"
ANDROID_ABI="${ANDROID_ABI:-21}"
HOST_PLATFORM="${HOST_PLATFORM:-linux-x86_64}"
WORK_ROOT="${WORK_ROOT:-$PWD/.ffmpeg-build}"
OUT_DIR="${OUT_DIR:-$PWD/build/ffmpeg-native}"
NDK_PATH="${NDK_PATH:-${ANDROID_NDK_HOME:-}}"

if [[ -z "$NDK_PATH" || ! -d "$NDK_PATH" ]]; then
  echo "NDK_PATH or ANDROID_NDK_HOME must point to an installed Android NDK" >&2
  exit 2
fi

DEFAULT_DECODERS=(ac3 eac3 dca truehd aac mp3 opus vorbis flac)
if [[ -n "${ENABLED_DECODERS:-}" ]]; then
  # shellcheck disable=SC2206
  DECODERS=(${ENABLED_DECODERS})
else
  DECODERS=("${DEFAULT_DECODERS[@]}")
fi

rm -rf "$WORK_ROOT"
mkdir -p "$WORK_ROOT" "$OUT_DIR"
MEDIA3_DIR="$WORK_ROOT/media"
FFMPEG_DIR="$WORK_ROOT/ffmpeg"

git clone --depth 1 --branch "$MEDIA3_VERSION" https://github.com/androidx/media.git "$MEDIA3_DIR"
git clone --depth 1 --branch "$FFMPEG_VERSION" https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_DIR"

if [[ -n "${ANDROID_HOME:-}" ]]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$MEDIA3_DIR/local.properties"
fi

FFMPEG_MODULE_PATH="$MEDIA3_DIR/libraries/decoder_ffmpeg/src/main"
JNI_DIR="$FFMPEG_MODULE_PATH/jni"
rm -f "$JNI_DIR/ffmpeg"
ln -s "$FFMPEG_DIR" "$JNI_DIR/ffmpeg"

pushd "$JNI_DIR" >/dev/null
chmod +x build_ffmpeg.sh
./build_ffmpeg.sh "$FFMPEG_MODULE_PATH" "$NDK_PATH" "$HOST_PLATFORM" "$ANDROID_ABI" "${DECODERS[@]}"
popd >/dev/null

# Media3 1.6.1's decoder_ffmpeg Android module builds its JNI layer with minSdk 21.
# Build the static FFmpeg archives against the same API level to avoid linking
# newer Bionic stdio globals (for example `stderr`) into the API-21 JNI library.
pushd "$MEDIA3_DIR" >/dev/null
./gradlew --no-daemon :lib-decoder-ffmpeg:assembleRelease
popd >/dev/null

AAR="$(find "$MEDIA3_DIR/libraries/decoder_ffmpeg/build/outputs/aar" -maxdepth 1 -type f -name '*.aar' | head -n 1)"
if [[ -z "$AAR" || ! -f "$AAR" ]]; then
  echo "FFmpeg decoder AAR was not produced" >&2
  exit 3
fi
unzip -l "$AAR" | grep -Eiq 'jni/.*/lib(ffmpeg|ffmpegJNI).*\.so|libffmpegJNI\.so' || {
  echo "FFmpeg AAR does not contain the expected JNI library" >&2
  exit 4
}

DEST="$OUT_DIR/media3-decoder-ffmpeg-${MEDIA3_VERSION}.aar"
cp "$AAR" "$DEST"
sha256sum "$DEST" > "$DEST.sha256"
cat > "$OUT_DIR/build-info.txt" <<INFO
media3=$MEDIA3_VERSION
ffmpeg=$FFMPEG_VERSION
android_api=$ANDROID_ABI
host_platform=$HOST_PLATFORM
decoders=${DECODERS[*]}
ndk=$NDK_PATH
aar=$DEST
INFO

echo "Built: $DEST"
