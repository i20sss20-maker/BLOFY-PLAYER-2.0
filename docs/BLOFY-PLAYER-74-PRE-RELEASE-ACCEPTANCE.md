# BLOFY PLAYER 74 — private acceptance checklist

**Status:** NOT APPROVED / do not publish. Keep `versionCode=2000074` and `versionName=2.0.0-rc07.55.6` until the owner accepts v74.

## Scope, phases and guardrails

- [x] Stage 1: BLOFY dark-purple visual refresh, remove the Riyadh/Dubai/London/New York wall clocks (not EPG timestamps), bundle SIL-OFL IBM Plex Sans Arabic for supported Arabic screens.
- [x] Stage 2: Home manual refresh button with a spinner *under the button*, queued/running/success/error states, coarse progress labels (live/movies/series); 30-minute quiet background checks remain system-scheduled, not guaranteed exact-time.
- [x] Stage 3: Preserve the staged catalog and last committed library; avoid repeated poster rebinds for identical content, bound Android TV RecyclerView view cache, protect playback from heavy refresh work.
- [x] Stage 4: Reuse BLOFY typography/surface system in Home, guide, catalog, settings, server management, search, detail/episode screens, and UI-only text in player HUD.
- [ ] Stage 5: Signed v74 QA package verified and tested on actual Android TV hardware. **Required before owner approval.**

### Explicit no-regression zones

No functional edits to `core/playback/**`, stream URL/headers, DRM/media engine switching, Xtream credentials/provider semantics, license/activation/payment, watch history, favorites, or data migrations. `PlayerActivity.kt` changes must be *only* font/typeface assignments, never playback transport/engine logic.

### Automated gates

- [ ] Latest v74 Android CI: `testDebugUnitTest`, lint, debug assemble, Google Play manifest, large catalog query validations, screenshot/layout regressions.
- [ ] Private signed QA workflow: unit tests, signed release `assembleRelease`, FFmpeg extension, expected release certificate SHA-256, application ID and version code/name; upload as Actions artifact. **No `gh release create`, Vercel deployment, Google Play publication, or downloads-page write.**
- [ ] Verify tests for RTL 960x540 TV, 720p compact width, phone, tablet; no clocks; remote-accessible refresh; correctly hidden spinner after terminal work state.
- [ ] Confirm that the latest build's signature matches the previously installed app. Do not uninstall older versions or erase data to force an upgrade. Installed versionCode must be < 2000074.

### Real-device acceptance matrix (pending, not implied by CI)

1. **TV navigation:** cold launch, RTL/English, focus up/down/left/right, refresh button focus, side navigation, long Arabic titles, font fallback, reduced-motion and low-RAM mode.
2. **Live playback:** TS and HLS channels; reconnect; zapping; playback failure fallback; audio tracks AC3/EAC3 where supported; 4K/HEVC if device/provider supports.
3. **VOD and series:** initial open, subtitle/audio selection, seek, resume, seasons/episodes, long watch session; no white-screen regression.
4. **Catalog refresh:** fresh account; 50,000 and 200,000 entries; manual tap; repeated taps; refresh while playing; when offline; source timeout, interrupted app process, local storage nearly full; staged rollback, restored previously committed catalog.
5. **Source/server:** multiple Xtream providers, switching active provider mid-download, re-entry offline, app restart, login/license state; never leak passwords in logs or diagnostics.
6. **Migration:** in-place signed upgrade from production 73 on TV, playlists/favorites/history retained, no loss of access. Do not downgrade devices that already have 75+.
7. **Performance:** record cold/warm start, Home render, p95 remote focus latency, image memory, stalls, failed refresh loops, CPU/memory/battery during playback against unmodified v73 and original v74.
8. **24-hour stability soak:** streaming and standby/resume; no repeated full-library downloads or uncontrolled background work.

**Release rule:** Only after successful CI plus owner hands-on approval should the v74 APK be considered ready for the public website or Play. The current official v74 release must remain unchanged until an explicit release decision.
