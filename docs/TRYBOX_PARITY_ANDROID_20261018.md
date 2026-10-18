# BLOFY PLAYER 2.0 — TryBox-inspired Android parity plan (2026-10-18)

Status: **research / experimental branch; not production approved**.

## What was verified and what was not

- Examined `https://trybox.app/` and the TryBox team's public release notices at `https://t.me/s/tryboxapp?before=55` and `https://t.me/s/tryboxapp?before=42`.
- The public homepage returns a JavaScript-driven shell to text-based inspection. **No full authenticated screen-by-screen visual inspection was possible.** Precise pixel matching needs actual screenshots or access through the app.
- Release notes describe cinematic browse/details, mobile navigation, search filters, player quality/audio/subtitle controls, continue watching, multiple profiles with avatar/PIN, clip feed, source choices, picture filters and optional AI discovery.
- Release notices change over time: source counts and temporary Sports/Downloads support should not be treated as stable.
- Recreate functional interaction and information architecture. Use BLOFY branding and original/licensed artwork; do not copy TryBox trademarks, private code, credentials, proprietary assets, or unauthorized media sources.

## Current BLOFY Android inventory (main branch at audit)

| Area | Existing implementation | Parity / work needed |
|---|---|---|
| Home | `HomeActivity`, BLOFY design constants | Tune hero, recommendation rows, quick resume, cinematic hierarchy |
| Movies | `MovieDetailsActivity`, `PosterCatalogActivity` | Tune metadata, related titles and polished navigation |
| Series | `SeriesDetailsActivity`, `EpisodesActivity`, parser and resume | Make seasons/episodes fast and state-resilient; next episode |
| Player | `BlofyPlaybackSession`, `PlayerActivity`, Media3 | Clear loading/failure states, exposed provider-backed source switcher, subtitle management and buffering diagnostics |
| Sources | Xtream/M3U, `direct_source` configured fallback | No invented mirrors; expose only the real primary and configured backup for matching content |
| User identity | Device activation, playlists, favorites/history and resume | Multiple isolated profiles, optional PIN and account-level sync |
| Search | `SearchActivity` | Filters/genre/year and responsiveness for big catalogs |
| Discovery | Local catalog | Clips and AI suggestions require separately licensed media/trailers and safe metadata input |
| Image settings | Current standard player UI | Picture presets depend on supported Android rendering path and devices |
| Android TV | Focus styling, key router, remote actions | Explicit regression tests for D-pad, Back, player overlay, low-RAM boxes |

## Delivery increments (each is optional until device acceptance)

1. **Beta 1 — reliability and selectable sources**
   - Terminal player error view with Retry/Back; no silent black screen on terminal failures.
   - User chooses between same-item provider-configured primary and direct backup, when provided.
   - No external player launches, no source scraping, no invented backup URLs.
2. **Beta 2 — TryBox-style cinematic browsing**
   - Hero banner, layered metadata, categorized horizontal rails, Continue Watching, strong mobile and TV layouts.
   - Retain native D-pad focus, original BLOFY black/purple theme, Xtream/M3U workflow.
3. **Beta 3 — people and discovery**
   - Account profiles with separate watch/resume/favorites plus optional PIN and private cloud synchronization.
   - Faster advanced search with year/genre; licensed clip feed. No forced sign-out/data deletion.
4. **Beta 4 — advanced playback**
   - Multi-track subtitle selection, subtitle uploads if supported, select source from a provider-authorized list (not hardcoded 'eight').
   - Optional skip intro, auto-next, picture presets, and quality policies matched to device capability.
   - Optional AI discovery only with well-defined privacy and metadata licensing.

## Tests before merging a stage

- CI: `testDebugUnitTest`, `lintDebug`, `assembleDebug` pass; upload debuggable APK as a test artifact only.
- Real devices: Android phone + Android TV remote, different Android versions, at least three licensed provider test accounts, including slow/fast streams.
- Live TS/HLS (when supplied), movie and episode, subtitles, resumption after app restart, switch source, long playback and error recovery.
- Confirm identical package/signing identity for any eventual upgrade build and preserve activation, playlists, settings, favorites and progress.
- Review crashes, privacy, accessibility and zero secret leakage; do not roll out production until an owner accepts results.

## Visual fidelity input needed

Record screenshots or a short walkthrough from TryBox's **Home, Movie detail, Season/episode listing, Player quality/subtitle/source menu, Search, Profiles and mobile/TV navigation**. These screenshots are for comparison only; BLOFY will retain its own artwork and logo.

## Integration notes

- Existing primary + direct fallback is real in `ContentUrlResolver.directFallback`. When no provider backup exists, the source chooser must be hidden.
- Source 2–8 or additional external players are **not** guaranteed by BLOFY data. Any expansion requires real same-content links from authorized providers and transport/security checks.
- Main `main` branch and store release remain unchanged until review.
