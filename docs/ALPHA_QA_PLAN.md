# BLOFY PLAYER 2.0 — Alpha QA Plan

This plan is the release gate for the first real-device Alpha. It validates the behavior extracted from the 7 Max analysis plus BLOFY-specific activation/diagnostics features.

## Test matrix
Test on at least:
- Android TV / Google TV device
- Android box/receiver
- Android phone
- One slower/older Android device (API 23+ if available)

Test each provider independently. Never copy one provider's transport/profile assumptions to another.

## Build variants
1. Standard debug APK
2. FFmpeg debug APK (`BLOFY-PLAYER-2.0-ffmpeg-debug`)

Record app version, device model, Android version, provider, transport, Live format, and whether FFmpeg is bundled.

## Activation and identity
- [ ] Device ID remains stable after app restart
- [ ] Six-digit activation code remains stable
- [ ] QR matches device ID + activation code
- [ ] First device check receives trial according to backend policy
- [ ] Active device enters app
- [ ] Expired device is blocked
- [ ] Blocked device is blocked
- [ ] Offline cached entitlement works only while still valid
- [ ] Wrong activation code is rejected
- [ ] Portal playlist changes synchronize back to the app

## Local-first startup / sync
- [ ] First Xtream sync completes and opens Home without long 95% stall
- [ ] Second Connect opens local Room data without full re-download
- [ ] Manual refresh updates catalog
- [ ] Favorites survive refresh
- [ ] Locks survive refresh
- [ ] Last category/channel survives restart
- [ ] Switching saved provider loads that provider only
- [ ] Editing provider credentials works without duplicating it

## Live TV
For each provider test SD, HD, FHD and 4K/HEVC where available.

- [ ] First/saved channel preview starts automatically on TV
- [ ] Preview does not restart unnecessarily while focus is unchanged
- [ ] Rapid remote movement does not create a stream request for every key press
- [ ] OK enters fullscreen
- [ ] CH+/CH- changes within current category
- [ ] Numeric channel entry selects the correct channel
- [ ] Returning from fullscreen restores list/channel focus
- [ ] Favorite toggle persists
- [ ] Recent channels records actual fullscreen viewing
- [ ] EPG current/next displays correctly
- [ ] Catch-up appears only on archive-capable channels
- [ ] Catch-up program starts at the expected time
- [ ] Audio track selector works
- [ ] Subtitle selector works
- [ ] Video quality selector works
- [ ] Network disconnect shows controlled error state
- [ ] Network return can recover without app restart when possible

## Playback performance
Measure TTFF (time to first frame) from diagnostics.

Targets for investigation, not hard-coded transport timeouts:
- Live: flag repeated TTFF > 5 s
- VOD: flag repeated TTFF > 8 s
- Any > 15 s: capture diagnostics and provider profile

For every failure record:
- provider key
- content kind
- URL type (redacted)
- selected transport
- Live format
- TTFF
- buffering count
- Media3 error code
- whether same-URL retry ran
- whether external fallback launched

## Movies
- [ ] Movie list opens from local data
- [ ] Details page does not autoplay
- [ ] Plot/year/genre/duration/rating/backdrop appear when supplied
- [ ] Start from beginning works
- [ ] Resume works after partial playback
- [ ] Completed movie no longer shows misleading resume state
- [ ] Audio/subtitles/quality work
- [ ] 4K/HEVC movie works on capable hardware

## Series
- [ ] Series details does not autoplay
- [ ] Seasons are separated
- [ ] Episodes are ascending
- [ ] Episode resume works
- [ ] Previous/next episode works
- [ ] Natural completion launches next episode
- [ ] Completed episode state persists
- [ ] 4K/HEVC episode works on capable hardware

## M3U/M3U8
- [ ] Playlist downloads and parses
- [ ] Live grouping works
- [ ] Movie grouping works
- [ ] `SxxExx` episode recognition works
- [ ] Direct URLs are used without Xtream URL rewriting
- [ ] M3U live playback works with provider-specific transport behavior

## FFmpeg audio validation
Use the FFmpeg APK only for these checks and compare against standard APK.

- [ ] Settings reports FFmpeg bundled
- [ ] AC3 sample has audio
- [ ] EAC3 sample has audio
- [ ] DTS-class sample has audio when supported by the built extension
- [ ] No `NoSuchMethodError` / Media3 extension version mismatch
- [ ] Normal AAC content still plays correctly

## Remote / focus
On TV test only with D-pad for a full session.

- [ ] Login focus is visible and deterministic
- [ ] Home restores last focused tile
- [ ] Browser restores category/channel focus
- [ ] Movie details focus is deterministic
- [ ] Series/season/episode focus is deterministic
- [ ] Search results remain navigable while query updates
- [ ] Favorites/Continue Watching focus is stable
- [ ] Settings restores last focused action
- [ ] Provider Manager restores provider/action focus after refresh
- [ ] Back never traps the user or jumps to an unrelated screen

## Mobile behavior
- [ ] Phone uses touch-first content screen rather than TV preview UI
- [ ] No forced D-pad focus on phone
- [ ] Live does not auto-open preview streams merely from scrolling
- [ ] Movie/series details and playback work in portrait/landscape transitions as supported

## Theme validation
- [ ] VISION Home layout renders correctly
- [ ] CINEMA TV rail/stage layout renders correctly
- [ ] Theme switch preserves navigation and does not crash
- [ ] Login remains readable in both themes

## Provider profiles
For each real server:
- [ ] Confirm Live format (`ts` or `m3u8`)
- [ ] Confirm preferred transport (Cronet or HTTP)
- [ ] Confirm redirect behavior
- [ ] Confirm no global User-Agent/header workaround is being applied
- [ ] Confirm no global route ladder is used
- [ ] Save only provider-specific overrides that are proven by tests

## Release decision
Alpha may be called test-ready when:
1. Android CI is green.
2. Activation CI is green.
3. FFmpeg Native CI is green.
4. At least one TV/box and one phone pass the core flows.
5. Each target provider has a recorded playback profile and no unresolved blocker for Live/Movie/Series.
6. Any remaining failures have diagnostics evidence and a reproducible test case.
