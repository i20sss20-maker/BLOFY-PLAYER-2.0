# BLOFY PLAYER 2.0 — Current project state

## Accepted device-test baseline

- Repository: `i20sss20-maker/BLOFY-PLAYER-2.0`
- Branch: `rc07-commercial-stability`
- Commit: `72434a500946286b84e9c779fb44e02d6052144c`
- Version: `2.0.0-rc07.9`, version code `2000017`
- Signed Release #257 and Android CI #1208 succeeded. Production `/health` reports this commit, database ready and playlist encryption ready.

The current owner request is a comprehensive code audit, minimal bug fixes and verified dead-code cleanup in preparation for commercial release after real-device testing. Do not restart the project or add new features.

## Protected behavior

Do not modify Media3, FFmpeg, fallback behavior, playback engines/routes or the current theme without an explicit owner request. Audit findings in those areas must be reported separately. A general cleanup request does not waive this restriction.

On 2026-09-07, after reviewing the documented findings, the owner explicitly approved fixing these specific exceptions: Hidden Host target confidentiality, upstream stream error handling and shared subscriber PIN protection; fallback resume position, resume saving before manual episode transitions, original M3U URL preservation and Catch-up credential escaping. This authorization does not include changing Media3, FFmpeg, engine selection or the current theme. Keep the scoped fixes and regression tests in audit PR #36 until release gates are satisfied.

Preserve production signing identity, stored playlists, device identity and upgrade data. Keep large catalog imports streaming into Room, and preserve the known-good catalog when refresh is incomplete. Catalog navigation and search use local data; opening or returning to a catalog must not trigger a provider refresh.

## Verification and delivery

Investigate code and available logs before fixes, use the smallest justified change and add behavioral regression coverage. Run Android and activation CI on the proposed changes. Before delivering a new APK, increment its version and run the existing production-signed release pipeline. Do not weaken branch/signing gates to sign an audit branch.

Real-device results remain the final acceptance gate: Hidden Host, M3U, Xtream and huge catalogs, completeness of Live/Movies/Series, playlist persistence after restart, category speed, search, low-memory behavior, and Home remote focus. CI success alone does not prove these are fixed.

Earlier references to `professional-polish`, rc02 and release-from-main are historical. They do not override this handoff.
