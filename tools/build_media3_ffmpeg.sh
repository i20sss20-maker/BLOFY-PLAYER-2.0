#!/usr/bin/env bash
set -euo pipefail

MEDIA3_VERSION="${MEDIA3_VERSION:-1.6.1}"
FFMPEG_VERSION="${FFMPEG_VERSION:-n6.0}"
EXPECTED_MEDIA3_COMMIT="839c4a90f2ab36e48be73e1b5e907f3283dce72e"
EXPECTED_FFMPEG_COMMIT="ea3d24bbe3c58b171e55fe2151fc7ffaca3ab3d2"
EXPECTED_NDK_REVISION="28.0.13004108"
EXPECTED_GRADLE_VERSION="8.11.1"
ANDROID_ABI="${ANDROID_ABI:-21}"
HOST_PLATFORM="${HOST_PLATFORM:-linux-x86_64}"
WORK_ROOT="${WORK_ROOT:-$PWD/.ffmpeg-build}"
OUT_DIR="${OUT_DIR:-$PWD/build/ffmpeg-native}"
NDK_PATH="${NDK_PATH:-${ANDROID_NDK_HOME:-}}"
GRADLE_CMD="${GRADLE_CMD:-gradle}"

if [[ -z "$NDK_PATH" || ! -d "$NDK_PATH" ]]; then
  echo "NDK_PATH or ANDROID_NDK_HOME must point to an installed Android NDK" >&2
  exit 2
fi

if ! command -v "$GRADLE_CMD" >/dev/null 2>&1; then
  echo "GRADLE_CMD must name an installed Gradle executable (found: $GRADLE_CMD)" >&2
  exit 2
fi

if ! GRADLE_VERSION_OUTPUT="$("$GRADLE_CMD" --version 2>&1)"; then
  echo "Unable to query Gradle with GRADLE_CMD=$GRADLE_CMD" >&2
  exit 2
fi
GRADLE_VERSION_ACTUAL="$(
  awk '$1 == "Gradle" { print $2; exit }' <<< "$GRADLE_VERSION_OUTPUT"
)"
if [[ "$GRADLE_VERSION_ACTUAL" != "$EXPECTED_GRADLE_VERSION" ]]; then
  echo "Gradle $EXPECTED_GRADLE_VERSION is required (found: ${GRADLE_VERSION_ACTUAL:-unknown})." >&2
  exit 2
fi

NDK_PROPERTIES="$NDK_PATH/source.properties"
if [[ ! -f "$NDK_PROPERTIES" ]]; then
  echo "Android NDK source.properties was not found under NDK_PATH: $NDK_PATH" >&2
  exit 2
fi

NDK_REVISION="$(sed -n 's/^Pkg\.Revision[[:space:]]*=[[:space:]]*//p' "$NDK_PROPERTIES" | head -n 1)"
NDK_MAJOR="${NDK_REVISION%%.*}"
if [[ ! "$NDK_MAJOR" =~ ^[0-9]+$ ]] || ((NDK_MAJOR < 28)); then
  echo "Android NDK r28 or newer is required for default 16 KB ELF alignment (found: ${NDK_REVISION:-unknown})." >&2
  exit 2
fi
if [[ "$NDK_REVISION" != "$EXPECTED_NDK_REVISION" ]]; then
  echo "Android NDK $EXPECTED_NDK_REVISION is required for the pinned release build (found: $NDK_REVISION)." >&2
  exit 2
fi

TOOLCHAIN_BIN="$NDK_PATH/toolchains/llvm/prebuilt/$HOST_PLATFORM/bin"
LLVM_OBJDUMP="$TOOLCHAIN_BIN/llvm-objdump"
LLVM_READELF="$TOOLCHAIN_BIN/llvm-readelf"
if [[ ! -x "$LLVM_OBJDUMP" || ! -x "$LLVM_READELF" ]]; then
  echo "The selected NDK is missing llvm-objdump or llvm-readelf under $TOOLCHAIN_BIN" >&2
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

MEDIA3_COMMIT="$(git -C "$MEDIA3_DIR" rev-parse HEAD)"
FFMPEG_COMMIT="$(git -C "$FFMPEG_DIR" rev-parse HEAD)"
if [[ "$MEDIA3_COMMIT" != "$EXPECTED_MEDIA3_COMMIT" ]]; then
  echo "Media3 $MEDIA3_VERSION resolved to unexpected commit: $MEDIA3_COMMIT" >&2
  exit 2
fi
if [[ "$FFMPEG_COMMIT" != "$EXPECTED_FFMPEG_COMMIT" ]]; then
  echo "FFmpeg $FFMPEG_VERSION resolved to unexpected commit: $FFMPEG_COMMIT" >&2
  exit 2
fi

if [[ -n "${ANDROID_HOME:-}" ]]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$MEDIA3_DIR/local.properties"
fi
# Pin Media3's external native build to the same r28+ NDK used for the static
# FFmpeg archives. This avoids silently selecting an older side-by-side NDK on
# hosted runners where several NDK revisions are preinstalled.
printf 'ndk.dir=%s\n' "$NDK_PATH" >> "$MEDIA3_DIR/local.properties"

# Media3 1.6.1 leaves ndkVersion unset, so AGP otherwise selects its older
# default NDK and rejects the explicit r28 ndk.dir above. Pin every Android
# library module to the same verified NDK used for the FFmpeg archives.
MEDIA3_COMMON_CONFIG="$MEDIA3_DIR/common_library_config.gradle"
ANDROID_BLOCK_COUNT="$(grep -Ec '^android {[[:space:]]*$' "$MEDIA3_COMMON_CONFIG" || true)"
if [[ "$ANDROID_BLOCK_COUNT" != "1" ]]; then
  echo "Expected exactly one Media3 shared android block; found $ANDROID_BLOCK_COUNT" >&2
  exit 2
fi
sed -i "/^android {[[:space:]]*$/a\\    // Modified by BLOFY PLAYER: pin the verified NDK for reproducible JNI builds.\n    ndkVersion '$NDK_REVISION'" "$MEDIA3_COMMON_CONFIG"

FFMPEG_MODULE_PATH="$MEDIA3_DIR/libraries/decoder_ffmpeg/src/main"
JNI_DIR="$FFMPEG_MODULE_PATH/jni"
rm -f "$JNI_DIR/ffmpeg"
ln -s "$FFMPEG_DIR" "$JNI_DIR/ffmpeg"

pushd "$JNI_DIR" >/dev/null
chmod +x build_ffmpeg.sh
./build_ffmpeg.sh "$FFMPEG_MODULE_PATH" "$NDK_PATH" "$HOST_PLATFORM" "$ANDROID_ABI" "${DECODERS[@]}"
popd >/dev/null

# The selected built-in decoders are distributable under FFmpeg's
# LGPL-2.1-or-later configuration. Fail closed if an upstream build change or
# future edit enables GPL, nonfree, or version-3-only components.
FFMPEG_CONFIG_H="$FFMPEG_DIR/config.h"
if [[ ! -s "$FFMPEG_CONFIG_H" ]]; then
  echo "FFmpeg config.h was not produced" >&2
  exit 3
fi
for disabled_license_switch in CONFIG_GPL CONFIG_NONFREE CONFIG_VERSION3; do
  if ! grep -Eq "^#define ${disabled_license_switch}[[:space:]]+0$" "$FFMPEG_CONFIG_H"; then
    echo "FFmpeg license gate failed: ${disabled_license_switch} must be 0" >&2
    exit 3
  fi
done

# Media3 1.6.1's decoder_ffmpeg Android module builds its JNI layer with minSdk 21.
# Build the static FFmpeg archives against the same API level to avoid linking
# newer Bionic stdio globals (for example `stderr`) into the API-21 JNI library.
pushd "$MEDIA3_DIR" >/dev/null
"$GRADLE_CMD" --no-daemon :lib-decoder-ffmpeg:assembleRelease
popd >/dev/null

# Prepare the exact source, notices, build recipe, and relink materials that
# must accompany every distributed FFmpeg-enabled APK/AAB. FFmpeg is linked as
# static archives inside libffmpegJNI.so, so the Media3 decoder source is
# included as the relinkable "work that uses the Library" material.
COMPLIANCE_DIR="$OUT_DIR/compliance"
rm -rf "$COMPLIANCE_DIR"
mkdir -p "$COMPLIANCE_DIR"
cp "$FFMPEG_DIR/LICENSE.md" "$COMPLIANCE_DIR/FFmpeg-LICENSE.md"
cp "$FFMPEG_DIR/COPYING.LGPLv2.1" "$COMPLIANCE_DIR/COPYING.LGPLv2.1"
cp "$MEDIA3_DIR/LICENSE" "$COMPLIANCE_DIR/AndroidX-Media-LICENSE"
git -C "$FFMPEG_DIR" diff --no-ext-diff --binary > "$COMPLIANCE_DIR/ffmpeg-changes.diff"
git -C "$MEDIA3_DIR" diff --no-ext-diff --binary > "$COMPLIANCE_DIR/androidx-media-changes.diff"

# Apache-2.0 requires modified files to carry a prominent change notice. Keep
# the Media3 patch intentionally limited to the shared NDK pin, require the
# patch to be non-empty, and prove that it reverses cleanly from the built tree
# (therefore applies cleanly to the pristine pinned source archive).
MEDIA3_TRACKED_CHANGES="$(git -C "$MEDIA3_DIR" diff --name-only)"
if [[ "$MEDIA3_TRACKED_CHANGES" != "common_library_config.gradle" ]]; then
  echo "Unexpected tracked Media3 build changes: ${MEDIA3_TRACKED_CHANGES:-none}" >&2
  exit 3
fi
git -C "$MEDIA3_DIR" diff --check
if [[ ! -s "$COMPLIANCE_DIR/androidx-media-changes.diff" ]]; then
  echo "Media3 compliance patch is empty" >&2
  exit 3
fi
git -C "$MEDIA3_DIR" apply \
  --check \
  --reverse \
  "$(realpath "$COMPLIANCE_DIR/androidx-media-changes.diff")"
git -C "$FFMPEG_DIR" archive \
  --format=tar.gz \
  --prefix="FFmpeg-${FFMPEG_VERSION}/" \
  --output="$COMPLIANCE_DIR/FFmpeg-${FFMPEG_VERSION}-source.tar.gz" \
  "$FFMPEG_COMMIT"
git -C "$MEDIA3_DIR" archive \
  --format=tar.gz \
  --prefix="androidx-media-${MEDIA3_VERSION}/" \
  --output="$COMPLIANCE_DIR/androidx-media-${MEDIA3_VERSION}-source.tar.gz" \
  "$MEDIA3_COMMIT"

cat > "$COMPLIANCE_DIR/BUILD-AND-RELINK.txt" <<INFO
BLOFY PLAYER FFmpeg build and relink recipe

License: LGPL-2.1-or-later
Linkage: FFmpeg static archives linked into Media3 libffmpegJNI.so
FFmpeg ref: $FFMPEG_VERSION
FFmpeg commit: $FFMPEG_COMMIT
Media3 ref: $MEDIA3_VERSION
Media3 commit: $MEDIA3_COMMIT
Android NDK: $NDK_REVISION
Gradle: $GRADLE_VERSION_ACTUAL
Android native API: $ANDROID_ABI
Host platform: $HOST_PLATFORM
Enabled decoders: ${DECODERS[*]}
CONFIG_GPL=0
CONFIG_NONFREE=0
CONFIG_VERSION3=0

The Media3 1.6.1 build script configures FFmpeg with:
  --target-os=android --enable-static --disable-shared --disable-doc
  --disable-programs --disable-everything --disable-avdevice
  --disable-avformat --disable-swscale --disable-postproc
  --disable-avfilter --disable-symver --enable-swresample
  --extra-ldexeflags=-pie --disable-v4l2-m2m --disable-vulkan
  --enable-decoder=<each decoder listed above>

Rebuild/relink outline (run from an empty working directory):
1. Copy this compliance bundle into the working directory, then extract:
   tar -xzf FFmpeg-${FFMPEG_VERSION}-source.tar.gz
   tar -xzf androidx-media-${MEDIA3_VERSION}-source.tar.gz
2. Apply the BLOFY NDK pin and its modification notice:
   git -C androidx-media-${MEDIA3_VERSION} apply ../androidx-media-changes.diff
3. Install Android NDK $NDK_REVISION, Android SDK platform 36, CMake 3.22.1,
   Ninja, JDK 17, and Gradle $GRADLE_VERSION_ACTUAL. Set ANDROID_HOME and
   NDK_PATH to their absolute SDK and NDK paths.
4. Link the extracted FFmpeg tree into Media3:
   ln -s "\$(realpath FFmpeg-${FFMPEG_VERSION})" \
     androidx-media-${MEDIA3_VERSION}/libraries/decoder_ffmpeg/src/main/jni/ffmpeg
5. Build the FFmpeg archives with the exact Media3 command:
   MEDIA3_ROOT="\$(realpath androidx-media-${MEDIA3_VERSION})"
   FFMPEG_MODULE_PATH="\$MEDIA3_ROOT/libraries/decoder_ffmpeg/src/main"
   (cd "\$FFMPEG_MODULE_PATH/jni" && \
     ./build_ffmpeg.sh "\$FFMPEG_MODULE_PATH" "\$NDK_PATH" $HOST_PLATFORM $ANDROID_ABI ${DECODERS[*]})
6. Configure Media3 and build the JNI AAR with Gradle $GRADLE_VERSION_ACTUAL:
   printf 'sdk.dir=%s\nndk.dir=%s\n' "\$ANDROID_HOME" "\$NDK_PATH" > \
     "\$MEDIA3_ROOT/local.properties"
   (cd "\$MEDIA3_ROOT" && \
     gradle --no-daemon :lib-decoder-ffmpeg:assembleRelease)
7. Extract the matching BLOFY APK, replace each
   lib/<abi>/libffmpegJNI.so with the rebuilt interface-compatible library,
   then rebuild, zipalign, and sign the modified APK with the recipient's own
   signing key for the recipient's own use.

ffmpeg-changes.diff and androidx-media-changes.diff contain the exact build
tree changes. The FFmpeg diff is empty when upstream was built unmodified.
INFO

(
  cd "$COMPLIANCE_DIR"
  sha256sum \
    AndroidX-Media-LICENSE \
    BUILD-AND-RELINK.txt \
    COPYING.LGPLv2.1 \
    FFmpeg-LICENSE.md \
    "FFmpeg-${FFMPEG_VERSION}-source.tar.gz" \
    "androidx-media-${MEDIA3_VERSION}-source.tar.gz" \
    androidx-media-changes.diff \
    ffmpeg-changes.diff \
    > SHA256SUMS
  sha256sum --check SHA256SUMS
)

# Media3 can redirect module build output into a repository-level buildout
# directory, so never assume libraries/decoder_ffmpeg/build/outputs/aar.
mapfile -t AAR_CANDIDATES < <(
  find "$MEDIA3_DIR" -type f -name '*.aar' \
    \( -path '*decoder_ffmpeg*' -o -path '*decoder-ffmpeg*' -o -name '*ffmpeg*.aar' \) \
    -print | sort
)

AAR=""
for candidate in "${AAR_CANDIDATES[@]}"; do
  if aar_entries="$(unzip -Z1 "$candidate" 2>/dev/null)" && \
      grep -Eiq '(^|/)jni/[^/]+/lib(ffmpeg|ffmpegJNI).*\.so$' <<< "$aar_entries"; then
    AAR="$candidate"
    break
  fi
done

if [[ -z "$AAR" || ! -f "$AAR" ]]; then
  echo "FFmpeg decoder AAR was not produced or did not contain the expected JNI library." >&2
  echo "AAR candidates found under Media3:" >&2
  if ((${#AAR_CANDIDATES[@]})); then
    printf '  %s\n' "${AAR_CANDIDATES[@]}" >&2
  else
    find "$MEDIA3_DIR" -type f \( -name '*.aar' -o -name 'libffmpeg*.so' -o -name 'libffmpegJNI.so' \) -print >&2 || true
  fi
  exit 3
fi

DEST="$OUT_DIR/media3-decoder-ffmpeg-${MEDIA3_VERSION}.aar"
cp "$AAR" "$DEST"

# Media3's FFmpeg build produces all Android ABIs. Keep both 32- and 64-bit TV
# compatibility, then enforce the Android 16 KB requirement on every packaged
# 64-bit JNI library. A ZIP alignment check alone cannot prove ELF LOAD segment
# alignment, so inspect the final .so files with the selected NDK toolchain.
VERIFY_DIR="$(mktemp -d "$WORK_ROOT/verify-aar.XXXXXX")"
trap 'rm -rf "$VERIFY_DIR"' EXIT
unzip -q "$DEST" -d "$VERIFY_DIR"

EXPECTED_ABIS=(armeabi-v7a arm64-v8a x86 x86_64)
REQUIRED_64_BIT_ABIS=(arm64-v8a x86_64)

for abi in "${EXPECTED_ABIS[@]}"; do
  expected_library="$VERIFY_DIR/jni/$abi/libffmpegJNI.so"
  if [[ ! -s "$expected_library" ]]; then
    echo "FFmpeg AAR is missing jni/$abi/libffmpegJNI.so" >&2
    exit 4
  fi
done

for abi in "${REQUIRED_64_BIT_ABIS[@]}"; do
  library="$VERIFY_DIR/jni/$abi/libffmpegJNI.so"
  if ! "$LLVM_READELF" -h "$library" | grep -Eq 'Class:[[:space:]]+ELF64'; then
    echo "jni/$abi/libffmpegJNI.so is not a 64-bit ELF library" >&2
    exit 4
  fi

  mapfile -t load_alignments < <(
    "$LLVM_OBJDUMP" -p "$library" | awk '$1 == "LOAD" { print $NF }'
  )
  if ((${#load_alignments[@]} == 0)); then
    echo "No ELF LOAD segments found in jni/$abi/libffmpegJNI.so" >&2
    exit 4
  fi

  for alignment in "${load_alignments[@]}"; do
    if [[ ! "$alignment" =~ ^2\*\*([0-9]+)$ ]] || ((BASH_REMATCH[1] < 14)); then
      echo "jni/$abi/libffmpegJNI.so has unsupported LOAD alignment: $alignment (requires at least 2**14)" >&2
      exit 4
    fi
  done
  echo "Verified jni/$abi/libffmpegJNI.so: ELF64 with LOAD alignment >= 2**14"
done

sha256sum "$DEST" > "$DEST.sha256"
cat > "$OUT_DIR/build-info.txt" <<INFO
media3=$MEDIA3_VERSION
media3_commit=$MEDIA3_COMMIT
ffmpeg=$FFMPEG_VERSION
ffmpeg_commit=$FFMPEG_COMMIT
ffmpeg_license=LGPL-2.1-or-later
ffmpeg_linkage=static-archives-in-libffmpegJNI.so
config_gpl=0
config_nonfree=0
config_version3=0
android_api=$ANDROID_ABI
host_platform=$HOST_PLATFORM
abis=${EXPECTED_ABIS[*]}
required_64_bit_abis=${REQUIRED_64_BIT_ABIS[*]}
elf_load_alignment=2**14
page_size_compatible=16384
decoders=${DECODERS[*]}
ndk_revision=$NDK_REVISION
ndk=$NDK_PATH
gradle_version=$GRADLE_VERSION_ACTUAL
gradle_command=$GRADLE_CMD
source_aar=$AAR
aar=$DEST
compliance=$COMPLIANCE_DIR
INFO

echo "Built: $DEST"
