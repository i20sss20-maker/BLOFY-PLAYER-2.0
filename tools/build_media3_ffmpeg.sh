#!/usr/bin/env bash
set -euo pipefail

# Temporary release-only CI wrapper: run the exact rc07.46 FFmpeg builder.
# Pull-request checkouts are shallow, so fetch only the pinned tag when it is missing.
if ! git rev-parse --verify --quiet refs/tags/v2.0.0-rc07.46 >/dev/null; then
  git fetch --depth=1 origin refs/tags/v2.0.0-rc07.46:refs/tags/v2.0.0-rc07.46
fi
original="$RUNNER_TEMP/build_media3_ffmpeg-rc0746.sh"
git show v2.0.0-rc07.46:tools/build_media3_ffmpeg.sh > "$original"
chmod +x "$original"
"$original"

# The pinned emulator action resolves `sh` from PATH but its release gate uses
# Bash-only `pipefail`. Add an ephemeral PATH shim for subsequent CI steps only.
shim_dir="$RUNNER_TEMP/blofy-bash-shim"
mkdir -p "$shim_dir"
cat > "$shim_dir/sh" <<'SH'
#!/usr/bin/env bash
exec /usr/bin/bash "$@"
SH
chmod +x "$shim_dir/sh"
echo "$shim_dir" >> "$GITHUB_PATH"
