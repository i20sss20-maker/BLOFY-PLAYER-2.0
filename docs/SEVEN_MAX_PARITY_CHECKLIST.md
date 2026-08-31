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
- [x] direct_source retained as data and used only as a bounded internal fallback after the exact Xtream route
- [x] FFmpeg integration hook: version-locked optional native AAR input, extension renderer preference, build flag/status UI, and documentation
- [x] Media3 1.6.1-compatible FFmpeg native AAR builds successfully in CI and produces a BLOFY APK with the extension bundled
- [ ] Validate AC3/EAC3/DTS-class samples on real target hardware
- [x] External-player launch path (system/VLC/MX if installed) is available only from the explicit player button
- [x] Playback failures stay inside BLOFY; Android's app chooser is never opened automatically
- [x] Xtream live may try the alternate `.ts`/`.m3u8` endpoint once; M3U direct URLs are never mutated
- [x] Extensionless HLS live URLs receive an HLS media-type hint from the provider profile
- [ ] DASH (`.mpd`) module validation — deferred because the matching Media3 1.6.1 DASH artifact is not available in the offline release toolchain
- [x] Read-only playback cache policy (streaming does not write new spans)

## Local-first data
- [x] Room local catalog for categories/streams/episodes/EPG/watch state
- [x] Manual refresh instead of reload on every Connect
- [x] Preserve favorite/lock flags across catalog refresh
- [x] Atomic M3U catalog replacement across categories, streams and episodes
- [x] Xtream section isolation: failure in Live does not prevent Movies and Series from syncing
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
- [x] Flexible Xtream episode parsing across map/list/indexed/JSON-string provider responses
- [x] Continue Watching resolves episode rows, parent series, resume position and parental lock

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
- [x] Production activation/playlist backend connected at `https://blofy-player-2-0.vercel.app`
- [x] Portal accepts valid HTTPS and legacy HTTP provider URLs, with clear-text warnings and credential-safe server logs

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
- [x] Remote provider-profile configuration: database, authenticated device endpoint, admin GET/PATCH controls, safe Android client, and Connect-time application
- [x] BLOFY web activation/playlist management portal: same-origin RTL web UI, device/code authentication, AES-256-GCM encrypted playlist storage, add/edit/delete/active controls, and two-way app/portal synchronization

## Release gate
The Android implementation and BLOFY service feature set are ready for the `2.0.0-rc02` real-device gate. The canonical package for this clean rebuild is `tv.blofy.player.v2`, so it installs beside the legacy app instead of attempting an in-place update. Remaining unchecked items require a physical device/provider sample or the unavailable offline DASH artifact.
