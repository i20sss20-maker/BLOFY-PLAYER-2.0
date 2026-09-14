# BLOFY Windows — Android parity contract

## User requirement

2026-09-14: The Windows edition must match the current BLOFY PLAYER Android application, not a redesigned or merely similar desktop interface. Preserve the approved logo, colors, gradients, corner radii, component hierarchy, relative spacing, navigation and user-visible behavior. Adapt only platform-specific implementation and desktop input/window management.

## Pinned reference

Repository: i20sss20-maker/BLOFY-PLAYER-2.0
Android reference commit: dc0b0c84d7dd5973e8d0426f16793f14b9b06417 (website primary release rc07.46).
Use the Android source at this exact commit rather than an older design, iOS project or new mock-up. The desktop reference is the current TV/wide-screen layout. Do not silently replace it with the compact phone layout.

## Authoritative source files

- app/src/main/java/tv/blofy/player/ui/common/BlofyTvDesign.kt
- app/src/main/res/drawable/blofy_home_background.xml
- app/src/main/res/drawable-nodpi/blofy_logo.png
- app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt
- app/src/main/java/tv/blofy/player/ui/home/HomeActivity.kt
- app/src/main/java/tv/blofy/player/ui/catalog/PosterCatalogActivity.kt
- app/src/main/java/tv/blofy/player/ui/catalog/PosterStreamAdapter.kt
- app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt
- app/src/main/java/tv/blofy/player/ui/details/MovieDetailsActivity.kt
- app/src/main/java/tv/blofy/player/ui/details/SeriesDetailsActivity.kt
- app/src/main/java/tv/blofy/player/ui/player/PlayerActivity.kt
- app/src/main/java/tv/blofy/player/ui/settings/SettingsActivity.kt
- app/src/main/java/tv/blofy/player/ui/playlist/PlaylistActivity.kt
- app/src/main/java/tv/blofy/player/ui/playlist/BlofySubscriberActivity.kt
- app/src/main/java/tv/blofy/player/ui/library/LibraryActivity.kt
- app/src/main/java/tv/blofy/player/ui/library/RecentChannelsActivity.kt
- app/src/main/java/tv/blofy/player/ui/search/SearchActivity.kt

## Layout invariants already inspected

Login: activation/QR panel on the left, playlist panel on the right. Preserve the 0.82:1.18 panel weights, original Arabic labels, identity fields and activation/connect/manage actions.

Home: main content on the left, 190dp reference sidebar on the right. Preserve the original discover header, hero, continue-watching and last-channel panels, and selected-stories order. Do not move navigation to the top or left.

Movies/series catalog: original category rail and five-column poster-grid relationship. No added global home sidebar on these pages. Details open on selection; they do not auto-start playback.

Playback: retain preview-to-fullscreen navigation, resume/start-from-beginning actions, audio/subtitle controls, favorites and return/focus behavior. Windows media implementation must be isolated; Android Media3/FFmpeg/fallback code remains untouched.

Shared palette is taken directly from BlofyTvDesign.kt: Background #07050C; BackgroundRaised #0C0913; Surface #130E1C; SurfaceRaised #1C1429; SurfaceFocused #36224F; Purple #8B37FF; PurpleBright #B067FF; PurpleDeep #5B26B5; PurpleSoft #DCC2FF; Mint #71EBD2; TextPrimary #FFFFFF; TextSecondary #E4DDEC; TextMuted #A69DB3; Divider #3F304E.

## Acceptance gates — not yet passed

- [ ] Windows app compiles and produces an executable.
- [ ] Each translated page is compared against the pinned Android implementation.
- [ ] Paired Android/Windows runtime screenshots are reviewed at equivalent content viewport sizes.
- [ ] Keyboard, mouse and fullscreen transitions preserve navigation behavior and focus.
- [ ] Activation, playlist add/edit/switch, catalog refresh and large-catalog cancellation are tested.
- [ ] Live, movies, series, episode order, resume, audio and subtitles are exercised on authorized test streams.
- [ ] Signed installer/update path is verified before commercial distribution.

A source file or CI configuration is not evidence of a completed app. Do not label this Windows edition identical, complete, tested or commercially ready until the corresponding gates have actually passed. Android and production portal files must not be changed to accommodate the Windows port without separate authorization.
