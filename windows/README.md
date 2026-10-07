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
