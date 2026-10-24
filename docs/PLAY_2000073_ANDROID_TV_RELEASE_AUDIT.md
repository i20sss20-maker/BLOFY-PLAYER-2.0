# BLOFY PLAYER 2.0.0-rc07.55.5 / Google Play 2000073 — pre-release audit

Date: 2026-10-24. This report covers the source tree branched from `dev/rc0755-stable-new-domain`, **not** the unmerged cinematic design draft. No store publishing, release signing, production server or customer-account changes were made. The download-page screenshot labels 2000073; this does **not** independently prove which AAB/versionCode Play Console currently distributes.

## Source defects fixed on the private branch

1. Google Play-specific manifest omitted reachable `VlcFallbackActivity`, `LibraryDownloadActivity`, and `SectionSearchActivity` navigation targets. All now registered non-exported.
2. Manual catalog updates opened an intrusive full-screen import; saved-library updates now queue in WorkManager from both Settings and Provider Manager.
3. There was no periodic refresh. Check automatically about every 30 minutes (subject to OS scheduling, storage/network constraints and active video), with last-success freshness gating.
4. Active playback now preempts full-library downloads and deep metadata/artwork work. Includes TV live preview and VLC fallback, not only full-screen Media3.
5. Re-selecting a different server can rebind the automatic refresh and refresh the Home rails. Quiet Home reloads wait for navigation inactivity.
6. After **successful durable catalog commit**, an error/timeout in secondary entry-cache preparation no longer forces the customer to remain on a loading/error screen when the saved catalog is usable.
7. Catalog ingestion remains streaming; staged refreshes validate section completeness, retain the old library, preserve favorites/locks, and atomically promote validated rows. Work is serialized per provider, with separate manual and auto requests.
8. Source and merged Google Play manifests are explicitly audited for reachable Activity routes and sideload-install permission.

## Release-blocking issues (still OPEN)

- **P0: Very slow Xtream providers.** `CatalogRefreshWorker` now caps one background network sync at **7 minutes** and safely discards an incomplete staging area before WorkManager's ordinary ~10-minute execution limit. This protects last-good content but **does not** let giant/slow providers resume after timeout. Before release, implement a **durable resumable** protocol with per-section/segment checkpoints and safe source/version validation, or a fully compliant long-running foreground approach. Do not claim that every 30-minute poll successfully refreshes huge lists.
- **P0: Physical Android TV acceptance.** Debug compilation/unit tests cannot verify RAM/decoder behavior, playback stalls, D-pad focus, 4K hardware rendering, TV versions or process termination. Real devices are mandatory.
- **P0: Exact published AAB/version confirmation.** The screenshot and Git source show 2000073, but previous work references production 2000074. Confirm the current and highest Play Console versionCodes, signing lineage, and exact AAB before selecting the NEXT increasing versionCode.
- **P0: Google Play TV form-factor discoverability.** LEANBACK_LAUNCHER, no-touch feature, TV banner exist in source, but Play Console Android TV opt-in, device compatibility, review approval, TV screenshots and listing cannot be proved by source inspection.
- **P1: Network scale.** Without a provider/server catalog revision or conditional/delta endpoint, every automatic Xtream refresh re-downloads full live/VOD/series lists. Model server load, storage writes and bandwidth for active customers; consider efficient server-provided revision/ETag/delta sync before expanding rollout.
- **P1: Release R8/native package.** Re-run signed *isolated* Play-flavored R8/AAB checks for 64-bit ELF and 16 KB page support, API 23-36, ABI splits, signing and Play policy. FFmpeg debug CI alone is not proof of release AAB compatibility.

## Automated verification

- JVM unit tests: `testDebugUnitTest`; Android lint `lintDebug`; debug `assembleDebug`; instrumentation APK assembly `assembleDebugAndroidTest`.
- Google Play manifest-flavored `-PBLOFY_DISTRIBUTION=play lintDebug assembleDebug` and explicit APK merged-manifest checks, including no REQUEST_INSTALL_PACKAGES.
- `tools/check_catalog_queries.py`: SQLite performance/correctness with 200k rows.
- `tools/verify_play_2000073.py`: package-version/manifest/export/Activity intent checks.
- Native FFmpeg workflow exercises decoder packaging and native ABI alignment (run separately).
- Check *current final commit* CI; an earlier successful commit does not certify a later one.

## Required real-TV QA matrix before the single customer release

| Area | Test | Pass gate |
|---|---|---|
| Start & activation | Fresh install, existing paid account, airplane mode, revoked/expired access | No false logout; credentials/lease preserved; failures recover safely |
| Xtream catalog | Small and 50k/100k+ providers, truncated JSON, timeouts, credential/source change, insufficient storage | Atomic rollback on invalid refresh; no lost favorites/locks/history |
| Silent updates | 30m scheduling under online/offline, playback/preview/VLC, sleep/reboot, server switching | No full-screen refresh, no duplicate destructive jobs, eventual valid catalog |
| Playback | Live TS/HLS, zapping, films, episodic series, seek, resume, audio/subtitles, 4K/HEVC/VLC fallback | No white/black startup stalls or unhandled crashes in tested conditions |
| TV UI | D-pad focus, BACK behavior, remote numeric input, Arabic RTL, 720p/1080p/4K layouts | Focus preserved and usable without a mouse |
| Device resources | Low-RAM TV, long playback, storage nearly full, background app, rapid screen changes | No ANR/OOM; smooth recovery and acceptable memory/CPU |
| Play release | Signed AAB with true versionCode progression; TV device catalog and review status | Installation/update without clearing app data and discoverable on TV |

**No merge / no Play upload / no public release until all P0 gates pass.**
