# BLOFY PLAYER 2.0 — Current project state

## Current owner instructions — 2026-09-21

- Current owner-approved version: `2.0.0-rc07.55`, version code `2000067`. The owner requires both to remain unchanged for this delivery. This supersedes the historical version-increment instruction below.
- Android branches: `fix/rc0755-artwork-throughput` (unit/lint/phone/TV verification) and `fix/rc0755-favorites-artwork` (production-signed testing gate), draft PR #120.
- Delivered baseline before this broader audit: `e3250798bcf31c5a1a7399d1384868b4714a2973`. Previous evidence: 630 Android unit tests, API 31 TV / API 35 phone artwork and catalog recovery tests, R8 signed build. This does not imply customer-device acceptance.
- The owner now requests a broad code review, missing functionality and justified improvements. See `reviews/rc0755-code-audit.md` for implemented fixes, verification and remaining findings.
- Preserve the playback/theme boundaries below. Do not deploy this branch's older `services/activation` snapshot over the separately maintained backend or touch MarketOS. Website publication of the exact approved APK is now authorized below; use the current backend `main` for its release metadata.

- On 2026-09-21, after the PIN bypass finding and explicit scope were presented, the owner requested “كمل النسخة بعد التعديل ابي اجرب”. This authorizes unifying parental content checks, including episode parents and in-player channel switching, and producing the signed rc07.55 testing APK. Media3/FFmpeg, engine/fallback behavior and theme remain protected.

- Latest signed source after the approved PIN fix: `e6688dd54df2ad60245de0b80edb03d9bf4f8c9d`; final emulator QA `ecff1c1766a9d4dcaf3a0f9160b26438c84951d0` differs only in the Android test. 660 unit tests, zero lint errors (553 warnings), phone/TV PIN plus artwork/catalog recovery checks and production-signed APK/AAB gates passed. APK SHA-256: `40f70c4447b7a570e63b71181d56b6e5591959a58d63137161cef55f903ba55f`. See `reviews/rc0755-pin-verification.md`.

- On 2026-09-21 the owner accepted the delivered APK and explicitly requested publication: “اي ممتازه خلاص ارفعها فالموقع”. GitHub release `v2.0.0-rc07.55` now contains the identical APK, without rebuilding. Publication run `35593053281` verified the original signing run and the public download hash. Website PR #121 changes only its publication workflow and `services/update-distribution/release-store.mjs`, based on the latest backend main; merged as `8e9e6ff1a8ce80649a89c833c870d4cd3ce6c6bb` after Download Center and Azure Infrastructure CI passed. Azure now serves rc07.55 as its active release: `/health`, `/release.json` and `/downloads` verified; full GET `/d/blofy` and HEAD `/download/latest.apk` return HTTP 200 with the APK attachment MIME, no redirects and the expected 16,762,468-byte file. The full download SHA-256 matches the owner-approved APK. The current app library remains present. See the publication section in `reviews/rc0755-pin-verification.md` for links.

## Historical accepted device-test baseline — rc07.9

- Repository: `i20sss20-maker/BLOFY-PLAYER-2.0`
- Branch: `rc07-commercial-stability`
- Commit: `72434a500946286b84e9c779fb44e02d6052144c`
- Version: `2.0.0-rc07.9`, version code `2000017`
- Signed Release #257 and Android CI #1208 succeeded. Production `/health` reports this commit, database ready and playlist encryption ready.

The audit covers minimal bug fixes and verified dead-code cleanup in preparation for commercial release after real-device testing. Do not restart the project or add new features.

## Historical candidate — rc07.10

- Candidate version: `2.0.0-rc07.10`, version code `2000018`.
- Reviewed audit source: PR #36, commit `5f4a9e6c4427680df27631adb9cc9ec258bbfa34`, based on the accepted rc07.9 baseline above.
- On 2026-09-07 the owner requested “كمل وخلنا نجرب اخر شيء”, authorizing integration and a new signed APK for testing.
- Stage: preparing the rc07.10 release candidate. Integration, the signed release and real-device acceptance are not recorded as completed here. Retain rc07.9 as the historical accepted baseline until the candidate is tested and approved.

## Protected behavior

Do not modify Media3, FFmpeg, fallback behavior, playback engines/routes or the current theme without an explicit owner request. Audit findings in those areas must be reported separately. A general cleanup request does not waive this restriction.

On 2026-09-07, after reviewing the documented findings, the owner explicitly approved fixing these specific exceptions: Hidden Host target confidentiality, upstream stream error handling and shared subscriber PIN protection; fallback resume position, resume saving before manual episode transitions, original M3U URL preservation and Catch-up credential escaping. This authorization does not include changing Media3, FFmpeg, engine selection or the current theme. The subsequent release request authorizes integrating the reviewed scoped fixes and regression tests from PR #36 through the existing release gates.

Preserve production signing identity, stored playlists, device identity and upgrade data. Keep large catalog imports streaming into Room, and preserve the known-good catalog when refresh is incomplete. Catalog navigation and search use local data; opening or returning to a catalog must not trigger a provider refresh.

## Verification and delivery

Investigate code and available logs before fixes, use the smallest justified change and add behavioral regression coverage. Run applicable Android and activation checks on the proposed changes. Run the existing production-signed testing pipeline before APK delivery. Keep rc07.55 and version code 2000067 unchanged under the current owner instruction; the older instruction to increment each APK is superseded for this testing cycle. Do not weaken branch/signing gates to sign an audit branch.

Real-device results remain the final acceptance gate: Hidden Host, M3U, Xtream and huge catalogs, completeness of Live/Movies/Series, playlist persistence after restart, category speed, search, low-memory behavior, and Home remote focus. CI success alone does not prove these are fixed.

Earlier references to `professional-polish`, rc02 and release-from-main are historical. They do not override this handoff.
