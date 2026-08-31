# BLOFY PLAYER 2.0 — Alpha QA checklist

Use this checklist before calling an Alpha build test-ready. Record device, provider and content sample for every failure.

## Build gates
- [ ] Android CI green on the exact Alpha head.
- [ ] Activation CI green on the exact Alpha head.
- [ ] FFmpeg-native build green when testing the FFmpeg flavor; APK contains `libffmpegJNI.so`.
- [ ] Settings reports the expected FFmpeg bundled state for the tested APK.

## Devices
Test at minimum:
- [ ] Android TV / receiver with D-pad remote.
- [ ] Android phone.
- [ ] Android tablet or large-screen device.
- [ ] A lower-spec Android TV/box if available.

Record Android version, chipset/device name and network type for failures.

## Provider matrix
For every available Xtream provider:
- [ ] Login/authentication succeeds.
- [ ] Initial sync completes without hanging near 95%.
- [ ] Re-entering through Connect opens local Room data without full re-sync.
- [ ] Manual refresh updates catalog and preserves favorites/locks.
- [ ] Provider-specific TS/HLS choice is respected.
- [ ] Provider-specific Cronet/HTTP preference is respected.
- [ ] Switching provider does not leak settings from another provider.

For M3U/M3U8:
- [ ] Playlist downloads and parses.
- [ ] Groups appear correctly.
- [ ] Live direct URLs play.
- [ ] Movie-like entries play through details flow.
- [ ] `SxxExx` entries group into series/seasons/episodes.

## Live TV
For SD, HD, FHD and 4K samples where available:
- [ ] Category opens quickly from local data.
- [ ] Saved/first channel preview starts automatically on TV.
- [ ] Rapid D-pad movement does not start a stream for every intermediate item.
- [ ] OK enters fullscreen reliably.
- [ ] CH+/CH- switches within the current group.
- [ ] Numeric channel entry selects the intended channel.
- [ ] Back returns to the list and restores focus to the previous channel.
- [ ] Last category/channel is restored after leaving and reopening Live.
- [ ] Favorite toggle works from HUD and survives restart/refresh.
- [ ] Audio track selector works when multiple tracks exist.
- [ ] Subtitle selector and subtitle-off work when tracks exist.
- [ ] Quality Auto/manual selection works where adaptive/track variants exist.
- [ ] Now/Next EPG appears without blocking playback.
- [ ] Recent Channels records fullscreen viewing, not preview-only focus.
- [ ] One same-URL automatic retry occurs on playback failure; no route ladder is used.
- [ ] A terminal Media3 failure stays inside BLOFY and shows a clear error; External/VLC opens only from the user's explicit HUD action.

### Live performance targets
Record actual values from diagnostics:
- [ ] TTFF SD/HD acceptable for the provider/network.
- [ ] TTFF 4K recorded separately.
- [ ] Buffering count recorded for a 5-minute watch sample.
- [ ] No UI freeze while player is preparing/buffering.

## Movies
- [ ] Selecting a movie opens Details, not autoplay.
- [ ] Plot/year/genre/rating/duration/backdrop display when supplied.
- [ ] Start plays from zero.
- [ ] Resume prompt appears after partial viewing.
- [ ] Resume seeks to the saved position.
- [ ] Start-over ignores saved position.
- [ ] Progress saves on exit/background.
- [ ] Completed content no longer behaves like unfinished resume content.
- [ ] Audio/subtitles/quality controls work during playback.
- [ ] 4K/HEVC sample plays on a capable device.

## Series
- [ ] Series opens Details without autoplay.
- [ ] Seasons are separated.
- [ ] Episodes sort ascending by episode number.
- [ ] Episode Resume/Start-over works.
- [ ] Previous/Next episode controls use the expected episode order.
- [ ] Natural episode end advances to the next episode.
- [ ] Last episode does not loop or jump to an unrelated item.
- [ ] 4K/HEVC episode tested where available.

## FFmpeg audio compatibility
On the FFmpeg-enabled APK, test real samples if available:
- [ ] AC3 audio.
- [ ] E-AC3 audio.
- [ ] DTS/DCA audio where legally/technically available.
- [ ] TrueHD where device/container path permits.
- [ ] Normal AAC/MP3 playback remains unaffected.
- [ ] No `NoSuchMethodError` / renderer extension version mismatch.

## EPG / Catch-up
- [ ] Current/next EPG refreshes for the selected Xtream live channel.
- [ ] EPG data is read locally by HUD after refresh.
- [ ] Archive UI appears only for channels advertising archive support.
- [ ] Past EPG programs are ordered correctly.
- [ ] Catch-up URL resolves and plays a valid archived program.
- [ ] Unsupported channels do not show a broken archive action.

## Search / library / parental controls
- [ ] Search updates while typing with debounce.
- [ ] Search result opens the same Details flow as the browser.
- [ ] Favorites opens correct content type.
- [ ] Continue Watching opens the correct content and resume state.
- [ ] Locked content never auto-previews.
- [ ] Locked Browser/Search/Library entries require PIN.
- [ ] Wrong PIN does not open content.
- [ ] PIN create/change/remove flows work.

## Playlists
- [ ] Add Xtream playlist.
- [ ] Add M3U playlist.
- [ ] Select active playlist.
- [ ] Edit saved playlist without losing provider playback preferences.
- [ ] Manual refresh works per playlist.
- [ ] Delete playlist; if active, another saved provider becomes active when available.
- [ ] Focus remains stable after list refresh/edit/delete on TV.

## Activation
Against the deployed BLOFY activation backend:
- [ ] New valid device receives Trial for configured duration.
- [ ] Device ID and six-digit activation code must both match.
- [ ] Active device enters app.
- [ ] Expired device is denied.
- [ ] Blocked device is denied.
- [ ] Unknown/invalid response is denied.
- [ ] Valid cached entitlement permits temporary offline entry when backend is unreachable.
- [ ] Expired cached entitlement never permits offline entry.
- [ ] QR contains the expected BLOFY activation payload.

## UI / remote
On TV, walk every screen using only the remote:
- [ ] Login.
- [ ] Home VISION.
- [ ] Home CINEMA.
- [ ] Browser categories/content.
- [ ] Movie details.
- [ ] Series details/seasons/episodes.
- [ ] Player HUD.
- [ ] Search.
- [ ] Favorites / Continue Watching / Recent.
- [ ] Settings.
- [ ] Playlist manager/editor.
- [ ] PIN dialogs.

For each screen:
- [ ] Focus is always visible.
- [ ] No dead end where arrows cannot escape.
- [ ] Back returns to the expected screen.
- [ ] Returning restores meaningful previous focus.
- [ ] OK performs exactly one action per press.
- [ ] Rapid directional input does not freeze or crash.

## Network recovery
- [ ] Start playback, disconnect network, confirm controlled error/buffering behavior.
- [ ] Restore network and verify retry/re-entry behavior.
- [ ] Activation backend outage follows cached entitlement rules.
- [ ] Catalog remains browsable from Room during provider/API outage.

## Alpha release decision
Do not mark the Alpha test-ready until all build gates are green. Any playback failure must include provider, content type, stream format, device, Android version, TTFF, buffering count and terminal error code from BLOFY diagnostics.
