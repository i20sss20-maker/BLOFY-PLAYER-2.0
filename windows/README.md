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
