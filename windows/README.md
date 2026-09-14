# BLOFY PLAYER Windows 0.3.0 — provider compatibility build

This supersedes the old UI-only EXE and the first 0.2 functional test. Normal startup launches the connected Windows application while preserving the Android-derived BLOFY layout and original logo.

## Implemented

Persistent device identity and QR; existing activation API with Windows platform and hashed trial scope; device-scoped portal playlists; local add/edit/delete/switch for Xtream and M3U; optional explicit upload to the portal; encrypted local credentials; SQLite catalog staging with cancellation/failed-refresh protection; provider order; paged poster catalogs and search; movie details/cast/director; numeric seasons/episodes; favorites/resume; native LibVLC playback with MP4, MPEG-TS and HLS; one preview/fullscreen media session; audio/subtitle tracks and local subtitle files; playback/provider settings; per-user installer.

0.3 adds provider compatibility work based on the user's first real Windows test: multiple Xtream base-path probes, redirects, transient HTTP retry, compatibility User-Agent fallback for the API, Accept/Origin/Referer handling, Xtream `direct_source`, TS↔HLS live fallback, M3U `#EXTVLCOPT` headers, pipe-suffixed per-entry User-Agent/Referer headers, legacy saved-provider User-Agent migration, and an image-request compatibility User-Agent. Unstable native reconnect flags that caused a LibVLC access violation during CI were removed again; recovery is handled by the application layer.

## Evidence and boundaries

During the recent real-user test window, production BLOFY activation and device-playlist requests returned HTTP 200 in Vercel observability; no production runtime error was seen there. This narrows that test's failure toward provider/media compatibility rather than a portal outage. CI does not possess the user's paid IPTV provider credentials, so it cannot claim that every provider is verified.

`--verify-runtime` creates an isolated profile and loopback HTTP fixture. It exercises real WPF controls, DPAPI, SQLite, movie/episode/live native video decoding, TS, HLS, snapshots, fullscreen transitions, resume persistence, and activation denial using generated media. `Blofy.RuntimeTests` checks URL parsing, encryption, catalog staging and state isolation. CI also installs the generated setup into a clean directory and repeats runtime verification from the installed copy.

No paid subscription/provider was tested in CI. GPU-specific decoding, 4K/HEVC, every external subtitle format and every remote-control edge case are not yet field-certified. Full Android pixel/behavior parity is not certified. Catch-up, parental PIN, Stalker/hidden-host subscriber workflows, downloads, full localization, code-signing and automatic signed updates remain future work. Do not advertise this test build as the complete commercial Windows edition.

## Install/use

Run `BLOFY-PLAYER-Windows-0.3.0-Setup.exe` on Windows x64. The installer is per-user, self-contained and bundles the required LibVLC runtime; a separately installed VLC is not required. It is currently unsigned, so do not disable Windows protection globally to install it.

Existing 0.2 installations can install 0.3 over the top. The app keeps `%LOCALAPPDATA%\BLOFY PLAYER\Windows`, including device identity and playlists, and automatically migrates the old development User-Agent to the compatibility profile without invalidating the provider catalog fingerprint.

Open the app, allow activation check, add or select a playlist, then connect. Xtream accepts a base URL or a `player_api.php`/`get.php` style URL with credentials in their proper fields/query. M3U supports direct URLs plus common `#EXTVLCOPT` and `|User-Agent=...&Referer=...` variants. HTTP providers remain allowed after an explicit cleartext warning; HTTPS is preferred.

Escape returns; Enter/double-click expands live preview; F11 toggles playback fullscreen; Space pauses VOD; left/right seek VOD; up/down change live channels in fullscreen. Settings include TS/HLS preference, User-Agent, Referer, cache, hardware decoding and preferred audio/subtitle languages.

## Build

From the repository root on Windows with .NET 10 SDK:

```powershell
dotnet run --project windows/Blofy.RuntimeTests -c Release -warnaserror:NU1903 -- core-verification.json
dotnet publish windows/Blofy.Windows -c Release -r win-x64 --self-contained true -warnaserror:NU1903 -o publish/BLOFY-PLAYER
publish/BLOFY-PLAYER/BLOFY.Player.Windows.exe --verify-runtime --evidence-dir=runtime-evidence
```

The patched SQLite native package is pinned explicitly and CI treats NU1903 vulnerability warnings as errors. The Windows runtime remains independent of Android Media3/FFmpeg and production portal source; Windows-port commits are checked to ensure `app/` and `services/` are unchanged.
