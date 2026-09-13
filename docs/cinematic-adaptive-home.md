# Cinematic adaptive home

The approved visual direction uses charcoal surfaces and BLOFY's lavender accent, with compact controls and content shelves that adapt to the current window.

## Behavior

- Touch windows below 600dp use a compact header, live/movie/series tabs, a scrolling hero and library feed, and bottom navigation.
- Wider touch windows use the same content feed beside a navigation rail. TV keeps its remote navigation and a narrower rail.
- Touch actions retain a 48dp target. TV hero actions remain 34dp high. System bars and cutouts contribute touch-window insets.
- Continue-watching cards use landscape artwork and progress relative to the card's measured width. Other shelves use portrait cards sized for the available window.
- The selected home destination and focused cards use the BLOFY accent. Empty Arabic/4K shelves and an unconfigured promotion no longer create placeholder panels.
- The home feed and history updates now run on touch devices. Automatic hero rotation is restricted to TV.

The existing TV live preview, player engines, stream resolution, catalog persistence and production signing identity are unchanged. Release `2.0.0-rc07.31` advances the version code to `2000042` so it can update the previous production release. A generated design showing mobile live preview is a separate concept; this implementation does not add that feature.

## Verification

`HomeAdaptiveLayoutTest` checks Arabic and English phone/split-screen widths of 320, 360, 412 and 540dp, tablet widths of 600, 840 and 1280dp, hero-button bounds, navigation bounds, landscape continue-watching cards, touch target sizes, and opening search with one touch in an attached window. Existing TV layout, remote focus and live-preview regression tests remain part of the suite.

Two existing persistence test classes now close and clear their app database singletons between Robolectric cases. Without this isolation, a later case can reuse a SQLite connection invalidated by Robolectric's reset. This change affects test fixtures only.

Run the project's `testDebugUnitTest lintDebug assembleDebug` tasks with JDK 17 and the configured Android SDK. A local FFmpeg preview build also supplies the existing Media3 1.6.1 FFmpeg AAR through `BLOFY_FFMPEG_AAR`.

The tested local preview used the existing development signing key and version `2.0.0-rc07.30`, with build marker `cinematic-preview`. All 452 unit tests passed, with zero lint errors. The TV emulator was checked with that exact APK. Production `2.0.0-rc07.31` is built by the existing signed-release workflow, which independently tests and verifies the release package and certificate.

View hierarchy tests do not establish physical-device rendering or playback compatibility. The emulator rejected a 4K Dolby Vision sample with `ERROR_CODE_DECODING_FAILED` and `NO_EXCEEDS_CAPABILITIES`. Alwan HD playback also showed dropped frames; a physical-device comparison remains outstanding. This release changes the UI and packaging and does not claim to resolve those playback findings.
