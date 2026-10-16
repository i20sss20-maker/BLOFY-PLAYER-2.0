# BLOFY PLAYER for Windows

Native Windows port of BLOFY PLAYER based on the Android rc07.55 stable baseline.

## Product parity implemented

- Same BLOFY device ID format and 6-digit activation credential
- Same production activation API using `platform=windows`
- QR/portal activation and renewal entry
- Portal playlist sync for Xtream lists
- Xtream Codes login and server validation
- Local M3U/M3U8 list support
- Live / Movies / Series catalogs
- Category browsing
- Series seasons and episodes
- Movie/series details
- Favorites
- Instant Arabic-aware search
- Watch progress and resume
- Persistent settings and catalog cache
- LibVLC playback with hardware decoding
- HLS/TS live formats
- Audio-track switching
- Subtitle-track switching
- Keyboard/remote-style controls
- Fast live channel switching with Up/Down
- Self-contained Windows x64 build
- BLOFY cinematic design tokens copied from the Android app:
  - background #08060D
  - surface #241536
  - white #F3F4F6
  - muted #C9BCD9
  - accent #D0B2FF

## Keyboard controls in player

- Enter / Space: Play or pause
- Left / Right: Seek 10 seconds
- Up / Down: Previous or next live channel
- F: Full screen
- M: Mute
- Esc: Exit full screen / close player

## Build

```powershell
cd windows\src\BlofyPlayer.Windows
dotnet restore
dotnet build -c Release
dotnet publish -c Release -r win-x64 --self-contained true -o ..\..\publish
```

## Windows 0.4.13 — artwork stability (development build)

- Caps network poster bodies at 8 MB even when a server omits or lies about Content-Length, avoiding unbounded RAM allocation.
- Deletes corrupt/oversized disk cache entries and retries from the network.
- Writes only successfully decoded images to disk, using unique temporary names for concurrent poster sizes.
- Bounds weak-reference poster metadata for huge catalogs and skips already-cancelled poster requests.
- Adds executable regression checks for payload boundaries and cancellation in Windows CI.

This change does **not** imply that every IPTV provider, GPU, 4K stream or device has been tested, and the Windows setup is still unsigned. Do not publish it as a signed production release without real-device smoke tests.

## Windows 0.4.14 — security and release traceability

- Redact streaming URLs, Xtream credentials and account identifiers from crash diagnostics and the app's fatal-error dialog; bound crash log size.
- Keep activation, subscriber and cloud User-Agent/backup version metadata synchronized with the Windows build.
- Add targeted automated regression checks for credential redaction and version identity.
- CI uploads a SHA256 checksum beside the unsigned Windows setup.

### Mandatory release acceptance checks

1. On a clean Windows 10/11 x64 system, install and launch without disabling Windows protection. Check Defender/SmartScreen results.
2. Confirm the upgrade from 0.4.12 keeps device ID, activation, profiles and watch history; test uninstall/reinstall behavior.
3. With authorized subscriptions, verify activation, QR, Xtream/M3U, live/TV EPG, VOD resume, episode selection, provider switching and subtitles.
4. Soak-test SD/HD/4K HLS/TS for 20+ minutes and exercise remote controls during buffering and network outages.
5. Independently malware-scan the build and code-sign it with the official certificate before distributing it as a commercial Windows release.
6. Verify copied diagnostics and crash.log contain no credentials or full stream URLs.

A CI success is not certification of real-device 4K, paid-provider compatibility or commercial-release security.

## Windows 0.4.15 — update safety and cache retention

- Download suggestions from the official Windows update feed now accept only HTTPS BLOFY-controlled hosts or assets from this repository's exact GitHub release path. Lookalike hostnames, credentials in URL, non-standard ports and unrelated repositories are rejected.
- Public GitHub preview/pre-release builds are excluded from the in-app update prompt.
- Disk artwork cleanup now **keeps newest/most-recently-used images** under the 600MB/3500-file budget; previously it could remove fresh posters when the byte limit was exceeded.
- Successfully reopened cached posters refresh their last-used timestamp at most once per hour.
- Windows CI tests updater URL rules, artwork quota logic, streaming byte limits, token redaction, release version agreement, compilation and installed EXE packaging.

**Release status:** unsigned preview for Windows x64; real licensed providers, playback sessions, antivirus reputation, code signing and long-duration 4K remain manual release gates. Do not disable Windows Defender or publish an update as production solely from a green CI build.

## Windows 0.4.17 — Android parity and connectivity recovery (QA preview)

- Sync both **M3U** and **Xtream** lists saved through the official BLOFY device portal. Preserve M3U type and URL when an existing local provider is updated.
- A verified active/trial device can open with a **previously saved local catalog** even if a portal refresh fails. This does not bypass a blocked or expired activation.
- Retry a transient activation request once; display the server's explicit blocked state rather than describing it as an Internet failure.
- Add credential-free **server + database connectivity checks** to activation and the settings/subscription summary. A healthy BLOFY API does **not** mean a third-party content source or license works.
- Increase LibVLC streaming buffer moderately and consider more **distinct authorized alternative URLs** before concluding playback failed. Preserve signed URL query strings and do not claim Widevine/DRM support.
- Keep diagnostics private: never paste stream URLs, passwords, device credentials or tokens in public CI logs/issues.
- Windows x64 artifacts are built automatically for PR validation. Real-device verification remains necessary before distribution.

**QA priority:** Test portal M3U sync, device activation, on/offline startup with cached lists, legitimate Xtream streams, HLS/TS live switching, VOD seeking, audio/subtitles, QR registration and update/rollback on Windows 10/11. Do not promote an unsigned build to stable solely because CI passes.

## Windows 0.4.19 — live and VOD recovery (QA preview)

- Uses VLC's native HTTP agent first for generic streams; a genuinely different browser agent is tried only as a fallback. Explicit per-channel M3U user agents remain authoritative.
- Releases the live mini-preview connection before fullscreen, reducing clashes for licensed providers that permit only one simultaneous stream.
- The live mini-preview itself tests up to four distinct URLs, including TS/HLS alternatives, without delaying channel browsing or EPG.
- Adds a last-resort legacy Xtream live URL pattern, while retaining the provider's original direct URL and signed query parameters unchanged.
- Keeps an opaque dark loading layer over WPF's native VLC surface until a video output is detected, avoiding a white startup flash.
- Reduces initial VOD network caching and accelerates bounded retries when no frames are produced.
- Increases the client, setup and CI-validated version to 0.4.19.

**Acceptance gate:** Windows build and self-contained setup smoke tests must pass. Real-world live/VOD playback still requires testing on Windows 10/11 against *authorized* sources with varying TLS/TS/HLS/container formats; this preview does not add Widevine/DRM decoding or imply that a particular provider is compatible. Preserve an installed rollback version until live video, audio/subtitles, seeking and 20-minute playback are verified.

## Windows 0.4.20 — live playback and connection lifecycle (QA preview)

- Stop the previous LibVLC media/socket **before** starting another TS/HLS live source. This reduces overlapping sessions with legitimate one-connection IPTV accounts.
- Limit URL and alternate HTTP-agent attempts predictably; when an API-provided direct source expires, retry a generated Xtream live URL with the alternate agent rather than retrying the same expired direct URL. No endless reconnection loops.
- Release the mini-preview's decoder lock between frame checks. Channel fullscreen no longer waits behind four sequential 5–6-second preview watchdog windows.
- Ignore stale native VLC error callbacks in the first four seconds after a new channel starts, preventing a previous-channel error from immediately changing the new channel.
- Give slowly starting VOD more time to produce a first decoded video frame instead of automatically interrupting it at ~14 seconds.
- Version 0.4.20 is separate from 0.4.19 for safe QA comparisons and rollback. All new retry-policy cases are included in the Windows regression runner.

**Not yet certified:** A successful Windows CI and setup smoke-test only establishes build/install health. Use authorized Xtream and M3U test streams on a real Windows 10/11 x64 PC to verify single-connection live playback, TS/HLS switch, 4K decoding, VOD start/seek/subtitles and extended playback before releasing to users. No DRM bypass or stream rebroadcasting is performed.

## Windows 0.4.21 — Android UI parity: For You + EPG reminders (QA preview)

- Adds the **"لك" (For You)** sidebar page, using favorites, recently watched titles,
  current profile, matching genre and category, and catalog quality/recency.
  All recommendations run locally using bounded catalog indexes: no viewing
  history is uploaded and no full IPTV collection is sorted on the UI thread.
- Adds five-minute **EPG program reminders** from the live channel guide, plus
  a reminder manager under Live settings. Reminders are isolated by user
  profile, linked to the configured provider, deduplicated and persisted
  without passwords, stream links, or device tokens. Kids profile restrictions
  are respected when offering to open a reminder.
- Unlike Android's background WorkManager notifications, Windows reminders
  are currently **in-app only**, delivered while the BLOFY desktop window is
  open and not showing a playback overlay. They do not wake a closed app.
- Includes the live URL/decoder recovery and server-source checks from 0.4.20.
- CI checks For You selection, bounded catalog behavior, reminder scheduling
  and isolation, Windows compilation, the self-contained setup, and installer
  smoke testing.

**QA gates:** Windows 10/11 real-device playback, EPG source coverage,
parental profile behavior, remote/focus navigation, update/rollback, and
extended TS/HLS/VOD sessions remain to be verified before a stable release.
DRM-protected media still require authorized compatible playback support.
