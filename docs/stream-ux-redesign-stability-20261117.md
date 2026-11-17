# BLOFY STREAM — full UI redesign and stability acceptance (2026-11-17)

## Scope and safety
- This branch starts from the ANES-based 55.8.32 audio-sync baseline, **not** the FoXFM-only 55.8.33 candidate.
- Keep the production APK, update channel, customer activation, server-side ANES feed, and Google Play untouched until explicit acceptance.
- Redesign the Android/Android TV app holistically, not only audio. Do not replace the core playback engine or remove existing capabilities without comparative evidence.
- All changes require emulator + real-device verification. No promise of zero bugs before testing.

## Areas to redesign
1. Playback: stable video surface, quick channel changes, clear loading/error states, fullscreen controls, audio selection/sync, network recovery.
2. Unified live panel: legible compact rows, persistent selected/playing channel, scroll preservation, visible current-channel indicator, attached audio/actions, accessible footer.
3. Navigation: keep DPAD/keyboard/touch focus on selected channel after switch, never auto-jump to Search, restore focus after dialogue, predictable BACK/OK/LEFT/RIGHT.
4. Discovery: fast Arabic/English search, favorites, recents and all channels, consistent category navigation without interrupting playback.
5. System: RTL/LTR layout, scalable TV 720p/1080p and Android 9, settings, update flow, diagnostics and accessibility.
6. Performance: measured cold-start, list virtualization, channel-switch latency, memory use and error rates before and after UX changes.
7. Audio: preserve working ANES sources while diagnosing failing FoXFM entries separately, ensure reverse/forward sync both function, avoid audio failures stopping video.

## Required release gates
- No regression in live video, movies/episodes, activation, download/update or language switching.
- Navigate BLOFY 1 → BLOFY 2 → BLOFY 3 and reopen the panel: row of playing channel receives focus; Search not focused; DPAD traverses visible list without jumping.
- Search gains focus **only** on explicit selection and remains usable with keyboard; text entry must not lose focus during filtering.
- Switch to favorite/recent, return to all; selection and scroll are sensible; current channel continues playback.
- Audio success/failure/415 cases recorded by source and device; working video never force-restarted due to sidecar audio failure.
- Full regression on Android TV remote, touch, mouse, keyboard, Android 9, Arabic and English; a signed installable QA build validated on device.
- Track outstanding defects. Release only after tests/owner review. Keep rollback package and stable release available.

## Progress
- Initial repository review: current STREAM live panel is in `LiveChannelOverlayLifecycle.kt`; audio tracks are managed through `StreamArabicAudioCatalog.kt`.
- First isolated branch fix: request focus on the playing channel row on overlay open instead of default EditText search focus.
- Tests/builds/real-device checks: **not yet executed**. Do not distribute this branch as production.
