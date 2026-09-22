# rc07.55 startup and durable library audit — 2026-09-22

Owner scope: investigate the blank/frozen screen after the BLOFY logo, review the Android project, improve catalog/artwork storage, and provide a testing build. Preserve version 2.0.0-rc07.55 (2000067), signing identity, current theme, playback engines and existing customer data.

## Findings and changes

- Login called synchronized `DeviceIdentity.cachedIdentity` on the main thread before its first frame. The same monitor protects synchronous preference commits and Android identity reads during background registration. Cached reads now run on IO; a late cached identity cannot overwrite an identity resolved by the live login flow. An independent UI deadline also turns a blocked identity read into an actionable retry message even after saved playlist cards have appeared.
- Application startup registration handled remote failures but left the initial Room/identity operation outside that boundary. Recoverable local exceptions now defer registration instead of escaping the application coroutine. Cancellation and fatal errors still propagate, and logs omit exception messages/credentials.
- Home's saved-entry check displayed only a background while waiting for Room, with no error or deadline handling. It now shows a loading state and independently returns to Login after an eight-second blocked read, clearing only the startup shortcut hint.
- First-import batches wrote catalog and search rows in separate transactions. Both writes now share one transaction; an FTS failure rolls the entire batch back.
- Durable artwork downloaded fixed groups: a slow request blocked later work even while other slots were free. A fixed number of workers now drains each bounded page continuously. The concurrency limits remain unchanged.
- The download journal committed each image intent/completion separately. It now commits bounded batches before HTTP and after atomic image writes, retaining partial successes and missing intents through cancellation. Its v1→v2 migration preserves the queue, adds failed-item tracking and binds displayed progress to the catalog epoch. WAL supports concurrent status reads.
- Artwork/journal hashes constructed 32 formatters per key. Direct lowercase hexadecimal encoding preserves every existing SHA-256 filename. A desktop Java microbenchmark verified 3,000 equivalent Unicode keys; 5,000 hashes took 74–460 ms with formatters and 1–84 ms with direct encoding across warmup-sensitive runs. This is a CPU microbenchmark, not a claim about device/network download speed.
- A Library download status card/page shows local artwork across all playlists, known pending images/details for the active playlist, failed items, scan completeness, and an explicit resume action. Opening it performs local reads only. Reviewing phone/TV screenshots identified a collapsed resume control; it now has a 48 dp minimum touch/focus target. Counts can increase while discovery runs; unavailable source images remain pending. It does not invent a total or a completion percentage.

## Review boundaries

The review includes the Android startup/lifecycle paths, identity and credential access, Room catalog import/promotion, search indexing, favorites/artwork, durable preparation workers, storage cleanup, and settings/status UI. Repository-wide scans checked blocking calls, lifecycle work and source changes. The complete Android unit/lint suite and phone/TV fixture flows are the verification gates; this is not a claim that every line is proven correct.

No production device trace was supplied. The identified freeze paths are reproduced with controlled blocked storage; acceptance on the affected customer's actual device remains distinct from emulator results. Saved artwork is permanent app data and survives normal restarts/cache cleanup; uninstalling the app or clearing its data removes it. Source availability, bandwidth and free storage still limit completion.

The activation/site backend and all Media3/FFmpeg/player source/configuration stay outside this patch. The old backend snapshot in this Android branch still has four portal-selector test failures: tests 68, 106, 108 and 109. They are identical in [the pre-change baseline](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35611300342) and [the current branch](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35708119611). These are not Android regressions; this snapshot must not replace the separately maintained backend. Android CI activation/update endpoints are loopback fixtures. Production signing retains the existing protected branch and certificate gates; the public website release must not be replaced by an unaccepted test build.

## Verification

Android application source: `555ed1fe125ce0d2841e3435eb7f0966189ce2eb`. [Verification run 35708112708](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35708112708) passed the regression job, API 35 phone and API 31 Android TV jobs on that exact source. [Android CI](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35708119668) also passed.

- 671 unit tests across 116 suites; zero failures, errors or skipped tests. The signed pipeline's independent unit artifact was downloaded and its SHA-256 verified.
- Android compatibility lint: zero errors, 554 warnings. No lint suppressions or gate removals were added.
- Phone and TV: favorites artwork online, missing-image resume after process restart, offline favorites after another restart, catalog recovery, favorites in a 200,000-row catalog while writes continue, and parental content gates all passed.
- With the identity monitor deliberately held, first frame and input succeeded before release: 1,279 ms on the phone emulator and 1,233 ms on TV, within the 8,000 ms watchdog. These are one-run fixture timings, not customer-device performance guarantees.
- The status page reported one pending image, one pending detail and one failed item, with resume enabled and no work enqueued merely by opening the page. Phone/TV screenshots were inspected, including the corrected resume-button size.
- Production-signed APK/AAB: [run 35708113906](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35708113906) passed, including release lint/R8, unchanged package/version/certificate, APK v1/v2 signatures, 16 KB zip alignment, four FFmpeg ABIs and signed Play bundle verification. [FFmpeg Native CI](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35708119741) also passed. The downloaded artifact ZIP and both binaries matched their recorded SHA-256 values; build metadata identifies the exact tested source.

Added regression cases cover identity-monitor contention, startup storage failure and retry, cancellation propagation, Home's independent deadline, atomic catalog/FTS rollback, journal migration/reopen/transaction failure, epoch isolation, continuous bounded downloads, unchanged artwork filenames, and local download-status rendering. Device evidence includes screenshots, logcat, frame/memory snapshots and a startup trace. Startup frame statistics contain only a few deliberately contended emulator frames; they are diagnostic artifacts, not a smooth-scrolling or real-device speed benchmark.

The PIN fixture exposed a TV keyboard/accessibility race: its numeric IME occluded the dialog button panel while the PIN dialog remained drawn. The fixture now dismisses a visibly present IME once with an actual BACK event before retrying the dialog click. Wrong-PIN, correct-PIN, cancellation and no-player-before-unlock assertions remain enabled; no production PIN/player code changed. Supplemental test-fixture commit `8c079ae0ff34f13b9b512169e53298f6c545d3e2` differs from the signed application source only in `ContentPinDeviceTest.kt`; its [additional verification run 35708577526](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/35708577526) also passed regression, phone and TV jobs. This supplemental test change does not change the delivered application binary.

Reference guidance checked: [Android ANR diagnosis](https://developer.android.com/topic/performance/vitals/anr) identifies main-thread lock contention and disk/binder work; [SQLite performance guidance](https://developer.android.com/topic/performance/sqlite-performance-best-practices) covers batching and WAL. Durability is retained: this patch does not relax synchronization or skip durable writes.

## Testing delivery

- APK: `BLOFY-PLAYER-rc07.55-startup-fix.apk`, 16,780,108 bytes.
- SHA-256: `a2a398d70153c0df713130a98f9638b94b642e4fe4a4a30023b5aedd7f535552`.
- Certificate SHA-256: `C3B98CCCD2F0C86809014ACD9368BF61C7004CFD419CD867B71FEF10BFA6255E`.
- Application `tv.blofy.player.v2`, version `2.0.0-rc07.55`, code `2000067`, min SDK 23, target SDK 36. Production activation/update endpoints and R8 enabled; all four existing native ABIs present.
- Install as an update over the existing app to preserve its playlists and saved artwork. Customer-device acceptance remains required; the accepted public website APK has not been replaced.
- The APK is a byte-identical renamed copy of the pipeline artifact, with no post-signing modifications.
