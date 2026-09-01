# BLOFY PLAYER 2.0 — Project Memory

## Professional polish candidate

The `professional-polish` branch is the active UX/performance candidate built on the proven current playback stack.

Release rules:
- Preserve the current internal playback engines, Media3/FFmpeg/VLC integration, network transports, URL resolution, provider compatibility and fallback routes.
- No external-player feature or chooser.
- No parental lock/PIN feature. Database migration 5→6 clears legacy locked flags.
- Catalog screens use the local Room database for navigation. Opening or returning to a list must not trigger a catalog network reload.
- Network catalog refresh is explicit from Settings or provider replacement.
- TV home uses real rotating movie/series artwork from the locally cached provider catalog.
- Search starts from the first character and uses cached content.
- Movies and series use poster-grid catalogs and route directly to their details screens.
- Series episodes open from cached episodes immediately; provider episode fetch is only needed when a series has no cached episodes yet or the user explicitly retries.
- Live TV uses local category/channel data, instant search, large preview, and the existing internal playback session.
- Settings use a remote-first grid and expose playback, network, format, buffer, aspect, audio, subtitles, live preview, resume, auto-next, motion, language, playlists, manual refresh and system status.

Do not merge this candidate until Android CI and the Media3/FFmpeg native workflow both pass on the latest branch head. After merge, create a signed RC build from main and verify signing, ABIs, FFmpeg packaging and activation before delivery.
