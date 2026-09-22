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
- A Library download status card/page shows local artwork across all playlists, known pending images/details for the active playlist, failed items, scan completeness, and an explicit resume action. Opening it performs local reads only. Counts can increase while discovery runs; unavailable source images remain pending. It does not invent a total or a completion percentage.

## Review boundaries

The review includes the Android startup/lifecycle paths, identity and credential access, Room catalog import/promotion, search indexing, favorites/artwork, durable preparation workers, storage cleanup, and settings/status UI. Repository-wide scans checked blocking calls, lifecycle work and source changes. The complete Android unit/lint suite and phone/TV fixture flows are the verification gates; this is not a claim that every line is proven correct.

No production device trace was supplied. The identified freeze paths are reproduced with controlled blocked storage; acceptance on the affected customer's actual device remains distinct from emulator results. Saved artwork is permanent app data and survives normal restarts/cache cleanup; uninstalling the app or clearing its data removes it. Source availability, bandwidth and free storage still limit completion.

The activation/site backend and all Media3/FFmpeg/player source/configuration stay outside this patch. All CI activation/update endpoints are loopback fixtures. Production signing retains the existing protected branch and certificate gates; the public website release must not be replaced by an unaccepted test build.

## Verification

Pending final CI results. Added regression cases cover identity-monitor contention, startup storage failure and retry, cancellation propagation, Home's independent deadline, atomic catalog/FTS rollback, journal migration/reopen/transaction failure, epoch isolation, continuous bounded downloads, unchanged artwork filenames, and local download-status rendering. Device evidence includes screenshots, logcat, frame/memory snapshots and a startup trace.

Reference guidance checked: [Android ANR diagnosis](https://developer.android.com/topic/performance/vitals/anr) identifies main-thread lock contention and disk/binder work; [SQLite performance guidance](https://developer.android.com/topic/performance/sqlite-performance-best-practices) covers batching and WAL. Durability is retained: this patch does not relax synchronization or skip durable writes.
