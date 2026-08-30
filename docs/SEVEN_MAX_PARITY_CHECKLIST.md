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
- [ ] FFmpeg audio extension for AC3/EAC3/DTS-class compatibility
- [ ] Real VLC/external-player fallback path
- [ ] Read-only playback/download cache policy equivalent where useful

## Local-first data
- [x] Room local catalog for categories/streams/episodes/EPG/watch state
- [x] Manual refresh instead of reload on every Connect
- [x] Preserve favorite/lock flags across catalog refresh
- [x] Episodes sorted by season then episode
- [ ] EPG refresh lifecycle for current/next live channel
- [ ] Recent channels list and UI

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
- [ ] Full TV remote state-machine polish across every screen
- [ ] Video quality selector (Auto/available tracks)
- [ ] Catch-up/archive flow

## Movies / Series
- [x] Dedicated movie details screen
- [x] Dedicated series details screen
- [x] No autoplay on details
- [x] Resume / start-over
- [x] Seasons and episodes separated
- [ ] Full Xtream movie/series metadata (plot, year, genre, duration, rating, backdrop)
- [ ] Next/previous episode from player and automatic next episode on natural end

## Playlists / identity
- [x] Xtream playlist add/save
- [x] Device ID + six-digit activation code foundation
- [x] Connect opens local data without forced sync
- [ ] M3U/M3U8 playlist parser and direct-URL playback path
- [ ] Full saved-playlist switch/edit/delete UI
- [ ] QR/barcode on login
- [ ] Real activation backend/status/expiry flow

## Themes / device classes
- [x] BLOFY theme profile foundation
- [x] TV launcher/banner and TV focus foundation
- [ ] Runtime theme engine with multiple Login/Home layouts
- [ ] Separate TV and Mobile layout/activity behavior

## Search / library / locks
- [x] Local search foundation
- [x] Favorites
- [x] Continue watching
- [x] Locked flag persisted
- [ ] Instant search while typing with debounce
- [ ] PIN/parental-lock UI and enforcement

## BLOFY additions (not claimed as 7 Max parity)
- [x] Playback diagnostics foundation (TTFF/buffering/errors)
- [ ] Diagnostics upload/control cloud
- [ ] Remote provider-profile configuration
- [ ] BLOFY web activation/playlist management portal

## Release gate
Do not call the first Alpha feature-complete until every unchecked item above that is required for 7 Max behavioral parity has either been implemented or explicitly deferred with a documented reason.
