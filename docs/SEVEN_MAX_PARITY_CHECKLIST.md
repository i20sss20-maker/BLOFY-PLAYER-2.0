# BLOFY PLAYER 2.0 — 7 Max parity checklist

This file locks the implementation targets confirmed or strongly supported by the static 7 Max analysis. BLOFY keeps its own code, brand, UI assets and product decisions.

## Playback architecture
- [x] Separate Live / Movie / Series URL builders
- [x] Xtream exact URL fast path
- [x] Live provider format TS or HLS
- [x] Media3/Exo primary playback
- [x] Cronet-first transport with HTTP fallback
- [x] Provider-scoped redirects/transport settings
- [x] One retry of the same URL; no global route ladder
- [x] direct_source retained as data, not primary Xtream route
- [x] FFmpeg integration hook: version-locked optional native AAR input, extension renderer preference, build flag/status UI, and documentation
- [x] Media3 1.6.1-compatible FFmpeg native AAR builds successfully in CI and produces a BLOFY APK with the extension bundled
- [ ] Validate AC3/EAC3/DTS-class samples on real target hardware
- [x] External-player launch path (system/VLC/MX if installed)
- [x] Automatic VLC/MX/external fallback after Media3 failure and one same-URL retry
- [x] Read-only playback cache policy (streaming does not write new spans)

## Local-first data
- [x] Room local catalog for categories/streams/episodes/EPG/watch state
- [x] Manual refresh instead of reload on every Connect
- [x] Preserve favorite/lock flags across catalog refresh
- [x] Episodes sorted by season then episode
- [x] EPG refresh lifecycle for current/next Xtream live channel
- [x] Recent channels list and UI

## Live TV / remote
- [x] Mini preview
- [x] Auto preview first/saved channel
- [x] Fullscreen player
- [x] Channel next/previous
- [x] Numeric channel entry
- [x] Remember last category/channel
- [x] EPG HUD read from local DB
- [x] Audio/subtitle track selection
- [x] Favorite toggle in HUD
- [x] Video quality selector (Auto/available video tracks)
- [x] TV remote/focus polish: centralized key routing, adapter focus retention, Home focus memory, Settings focus memory, provider-row/action focus restoration, player HUD D-pad behavior
- [x] Catch-up/archive flow for Xtream channels that advertise archive support

## Movies / Series
- [x] Dedicated movie details screen
- [x] Dedicated series details screen
- [x] No autoplay on details
- [x] Resume / start-over
- [x] Seasons and episodes separated
- [x] Local Xtream movie/series metadata (plot, year, genre, duration, rating, backdrop when supplied)
- [x] Next/previous episode from player and automatic next episode on natural end

## Playlists / identity
- [x] Xtream playlist add/save
- [x] M3U/M3U8 parser and supplied direct-URL playback path
- [x] M3U grouping with Live/Movie and SxxExx series/episode recognition
- [x] Device ID + six-digit activation code foundation
- [x] Connect opens local data without forced sync
- [x] Saved-playlist switch/update/delete UI
- [x] Edit existing saved playlist credentials/details in place
- [x] QR/barcode on login
- [x] Activation client flow: configurable endpoint, trial/active/expired/blocked states, expiry, cached offline entitlement and Connect gating
- [x] Activation backend implementation: PostgreSQL service, 7-day first-device trial, device/code binding, admin activation/block controls, Docker packaging and CI verification
- [ ] Deploy/configure the real BLOFY activation backend endpoint on production hosting

## Themes / device classes
- [x] BLOFY theme profile foundation
- [x] Runtime theme selection/profile application
- [x] TV launcher/banner and TV focus foundation
- [x] Multiple structurally distinct Home layouts per theme (VISION dashboard versus CINEMA TV rail/stage); Login remains BLOFY-branded and theme-aware
- [x] Separate TV and Mobile layout/activity behavior (TV browser/preview versus touch-first MobileContent; device-specific Home/Login/Playlist behavior)

## Search / library / locks
- [x] Local search foundation
- [x] Instant search while typing with debounce
- [x] Favorites
- [x] Continue watching
- [x] Locked flag persisted
- [x] PIN/parental-lock UI and enforcement across Browser/Search/Library guarded entry paths

## BLOFY additions (not claimed as 7 Max parity)
- [x] Playback diagnostics foundation (TTFF/buffering/errors)
- [x] Diagnostics upload/control cloud: redacted playback metrics upload from the player plus authenticated admin diagnostics query on the BLOFY service
- [ ] Remote provider-profile configuration (database + safe Android client foundation added; service route/admin controls and Connect-time apply remain)
- [ ] BLOFY web activation/playlist management portal

## Release gate
The Android implementation is parity-ready for Alpha QA. Remaining unchecked parity items require production deployment or physical-device/server validation rather than additional core feature construction.
