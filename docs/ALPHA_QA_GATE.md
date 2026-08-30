# BLOFY PLAYER 2.0 — Alpha QA Gate

This checklist is the release gate for the first real-device Alpha. A green CI build is necessary but not sufficient. Every item below must be tested on real providers/devices before calling the Alpha validated.

## Build identity
- [x] Android CI is green on the exact tested commit (`af08bd4`, Android CI #250).
- [ ] Settings shows the expected build/version.
- [ ] Settings shows whether FFmpeg is bundled.
- [x] FFmpeg CI verifies the APK contains `libffmpegJNI.so` before publishing the artifact (`af08bd4`, FFmpeg Native #57).

## Activation
- [ ] New device receives the expected trial state.
- [ ] Active device enters normally.
- [ ] Expired device is blocked.
- [ ] Blocked device is blocked.
- [ ] Offline cached entitlement works only while its cached expiry is still valid.
- [ ] Wrong activation code cannot claim another device identity.

## Local-first / startup
- [ ] First sync imports Live / Movies / Series successfully.
- [ ] Exit app completely, reopen, press Connect: local catalog opens without a forced network sync.
- [ ] Manual refresh updates the catalog.
- [ ] Refresh preserves favorites and lock flags.
- [ ] Loading does not stall at 95% after network work is complete.

## Provider matrix
For each provider, record its profile before testing:
- Provider type: Xtream / M3U
- Live format: TS / HLS
- Transport: Cronet-first / HTTP-first
- Redirect setting
- Archive/catch-up availability

Do not apply one provider's workaround globally.

## Live TV
- [ ] Category opens quickly.
- [ ] Saved/first channel preview starts automatically on TV.
- [ ] Fast D-pad movement does not create a stream connection for every intermediate row.
- [ ] OK enters fullscreen reliably.
- [ ] Channel Up/Down changes inside the same group.
- [ ] Numeric channel entry works.
- [ ] Last category/channel restores correctly.
- [ ] Recent Channels records fullscreen viewing, not preview-only focus.
- [ ] Favorite toggle works from HUD.
- [ ] EPG current/next is correct.
- [ ] Catch-up appears only for archive-capable channels and actually plays.
- [ ] Network loss/recovery produces a controlled error/retry path.

## Playback performance
Record TTFF from diagnostics for each sample.
- [ ] SD live channel
- [ ] HD live channel
- [ ] FHD live channel
- [ ] 4K/HEVC live channel
- [ ] HLS live channel
- [ ] MPEG-TS live channel

Target: identify provider/device outliers using measured TTFF, not guesses.

## Movies
- [ ] Details page opens without autoplay.
- [ ] Metadata renders when supplied.
- [ ] Start from beginning works.
- [ ] Resume works after leaving mid-playback.
- [ ] Audio track selector works.
- [ ] Subtitle selector/off works.
- [ ] Quality selector works with available video tracks.
- [ ] Media3 failure retries the same URL once only.
- [ ] Terminal failure follows configured external/VLC fallback behavior.

## Series
- [ ] Seasons are separated.
- [ ] Episodes sort ascending.
- [ ] Resume current episode works.
- [ ] Previous/next episode controls work.
- [ ] Natural end advances to the next episode.
- [ ] Completed progress does not create a broken resume loop.

## Audio codec matrix
Test on a device that normally lacks at least one codec in hardware.
- [ ] AAC
- [ ] AC3
- [ ] EAC3
- [ ] DTS (`dca`)
- [ ] TrueHD
- [ ] Vorbis
- [ ] Opus
- [ ] FLAC

For FFmpeg-specific validation, use the FFmpeg APK and confirm Settings reports FFmpeg bundled.

## M3U / M3U8
- [ ] Playlist downloads/parses.
- [ ] Group titles create sensible categories.
- [ ] Direct URLs remain direct; they are not converted to Xtream routes.
- [ ] Live versus Movie detection is acceptable for the test playlist.
- [ ] `SxxExx` entries map into Series/Episodes correctly.

## Search / library / locks
- [ ] Instant search updates while typing.
- [ ] Search result opens through the standard Details/Playback flow.
- [ ] Favorites open through the standard flow.
- [ ] Continue Watching opens through the standard flow.
- [ ] Locked content does not preview/play before PIN validation.
- [ ] PIN create/change/remove works.

## Remote / focus
Run this section on Android TV / receiver with a physical remote.
- [ ] Home restores last focused tile.
- [ ] Browser category/content focus never disappears.
- [ ] Returning from fullscreen restores the correct row/item.
- [ ] Settings restores the last focused action.
- [ ] Provider Manager restores provider row + action.
- [ ] Episode lists retain focus after returning from playback.
- [ ] Back never traps the user in a screen.
- [ ] Rapid Up/Down/Left/Right presses do not freeze or crash.

## Phone / tablet
- [ ] Phone uses touch-first content screen instead of TV preview flow.
- [ ] No forced TV focus behavior on phone.
- [ ] Tablet layout remains usable in portrait/landscape where supported.

## Stability soak
- [ ] Watch live continuously for 30 minutes.
- [ ] Switch channels repeatedly for 10 minutes.
- [ ] Play a movie for 30 minutes and seek repeatedly.
- [ ] Navigate a large category list aggressively.
- [ ] Background/foreground app during playback and recover cleanly.
- [ ] No crash, ANR, or unbounded memory growth observed.

## Release decision
The Alpha can be called validated only after:
1. Android + Activation CI are green on the tested commit.
2. At least three different provider profiles have been exercised if available.
3. At least one Android TV/receiver and one phone/tablet have been tested.
4. Critical playback failures have diagnostics captured with provider key, content kind, TTFF/buffering/error information.
5. Any deferred failure has a documented provider/device-specific reason rather than a global workaround.
