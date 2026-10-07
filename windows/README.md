# BLOFY PLAYER for Windows

Windows desktop port of BLOFY PLAYER. This branch starts from the rc07.55 stable Android baseline and keeps the Android app untouched.

## Stack

- .NET 10 LTS
- WPF desktop UI
- LibVLCSharp 3.10.1
- VideoLAN LibVLC Windows 3.0.24
- Existing BLOFY activation API with `platform=windows`

## Implemented in the first Windows foundation

- BLOFY purple/white Windows shell
- Arabic RTL layout
- Stable Windows BLOFY device ID in `BLOFY-XXXX-XXXX` format
- Six-digit activation credential
- Same activation endpoint used by Android
- Live playback engine wiring through LibVLC
- Navigation shell for Home / Live / Movies / Series / Favorites / Search / Settings
- Windows CI build and self-contained x64 publish

## Port parity target

1. Xtream Codes login and saved playlists
2. M3U/M3U8 import
3. Live categories, EPG, preview, fullscreen and fast channel zapping
4. Movies and series catalogs
5. Seasons / episodes / details / cast / country / server ratings
6. Resume playback and watch history
7. Favorites
8. Instant Arabic-aware search
9. Subtitle / audio / quality controls
10. White mode default + dark mode
11. QR activation / renewal flow
12. Remaining subscription/trial display
13. Provider headers, redirects and HLS/TS fallback
14. Local timezone handling
15. Auto-update channel for Windows
16. x64 installer/MSIX packaging

## Build locally

```powershell
cd windows\src\BlofyPlayer.Windows
dotnet restore
dotnet run
```

## Publish

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -o .\publish
```
