# BLOFY PLAYER Windows 0.2.0 — functional test build

This supersedes the old UI-only EXE. Normal startup now launches the connected Windows application; F1–F4 review shortcuts are not customer navigation.

## Implemented

Original Android logo and existing Android-derived login/home/poster templates; persistent device identity and QR; existing activation API with Windows platform and hashed trial scope; device-scoped portal playlists; local add/edit/delete/switch for Xtream and M3U; optional explicit upload to the portal; encrypted local credentials; SQLite catalog staging with cancellation/failed-refresh protection; provider order; paged poster catalogs and search; movie details/cast/director; numeric seasons/episodes; favorites/resume; native LibVLC playback with MP4, MPEG-TS and HLS handling; a single preview/fullscreen session; audio/subtitle tracks and local subtitles; playback/provider settings; per-user installer.

## Test boundaries

`--verify-runtime` creates a temporary isolated profile and a loopback HTTP server. It exercises actual WPF controls, DPAPI, SQLite, movie/episode/live native video decoding, snapshots, fullscreen transitions, resume persistence and activation denial using generated video and synthetic provider data. It never registers a real production device. `Blofy.RuntimeTests` exercises HTTP parsing, encryption, staging and state isolation without real provider credentials. Report JSON records the exact executed assertions; CI success, not source comments, is the evidence.

No paid subscription/provider was tested. GPU-specific decoding, 4K/HEVC, external subtitle behavior and every remote-control edge case are not yet field-verified. Full Android screenshot/pixel/behavior parity is not certified. Catch-up, parental PIN, Stalker/hidden-host subscriber workflows, downloads, full localization and signed automatic updates are not implemented. M3U pipe-suffixed per-entry headers are explicitly rejected rather than silently ignored. Do not advertise this as the complete commercial Windows edition.

## Install/use

Run `BLOFY-PLAYER-Windows-0.2.0-Setup.exe` (x64). The installer runs per user, includes the .NET and LibVLC runtime, and does not require a separately installed VLC. It is unsigned. Do not disable Windows protection globally to install it.

Open the application, let it check activation, add a playlist with the existing Add/Manage action, and connect. The activation state is supplied by the existing BLOFY portal; a blocked/expired device is not unlocked locally. Only the app-namespaced trial-scope hash is sent, not the raw Windows identifier. Local providers are not uploaded unless the user checks the portal upload option. Normal HTTP providers require an explicit cleartext warning confirmation. QR credentials remain in the URL fragment.

Escape returns; Enter/double-click expands a live preview; F11 toggles playback fullscreen; Space pauses VOD; left/right seek VOD; up/down change live channels in fullscreen. Settings include TS/HLS format, User-Agent, Referer, cache, hardware decoding and preferred audio/subtitle languages.

Data: `%LOCALAPPDATA%\BLOFY PLAYER\Windows`. Updates and uninstall retain this directory. A corrupted identity/key is not silently regenerated. Deleting the directory loses local credentials and activation identity.

## Build

From repo root on Windows with .NET 10 SDK:

```powershell
dotnet run --project windows/Blofy.RuntimeTests -c Release -- core-verification.json
dotnet publish windows/Blofy.Windows -c Release -r win-x64 --self-contained true -o publish/BLOFY-PLAYER
publish/BLOFY-PLAYER/BLOFY.Player.Windows.exe --verify-runtime --evidence-dir=runtime-evidence
```

`--verify-ui` retains the earlier isolated template regression checks. The Windows runtime is independent of Android Media3/FFmpeg code and the production portal source; those files are not changed by this port.
