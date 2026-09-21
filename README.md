# BLOFY PLAYER 2.0

Clean Android-native rebuild of BLOFY PLAYER.

## Core principles

- BLOFY identity first: black/purple premium TV-first UI.
- Local-first catalog and playback state.
- Separate Live, Movies, Series and Catch-up pipelines.
- Exact URL builders per content type.
- Provider-scoped profiles; no global compatibility hacks.
- Cronet-first transport with HTTP fallback.
- Media3 player core with FFmpeg audio extension support and explicit manual external-player action.
- Dedicated Remote Engine and Theme Engine.
- Activation, playlist management, diagnostics and future Control Cloud integration.

## Status

The current Android testing candidate is `2.0.0-rc07.55` (`versionCode 2000067`), tracked in draft [PR #120](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/pull/120). The owner explicitly requires this version to stay unchanged during testing. The latest delivered baseline before the September 21 audit is commit `e3250798bcf31c5a1a7399d1384868b4714a2973`, with persistent artwork, automatic catalog recovery and indexed favorites.

The broader audit and its remaining findings are documented in [the rc07.55 review](docs/reviews/rc0755-code-audit.md). A signed testing build is not a production rollout or final acceptance. See [project memory](docs/PROJECT_MEMORY.md) for the protected playback/theme boundaries. The activation backend has its own deployment history; the service snapshot on this Android branch must not be deployed over production.

The canonical clean-rebuild package is `tv.blofy.player.v2`, so it installs beside the legacy application. See [the Arabic final reference](docs/BLOFY_2_FINAL_REFERENCE_AR.md) and [the 7 Max parity checklist](docs/SEVEN_MAX_PARITY_CHECKLIST.md) before changing playback, catalog replacement, or TV focus behavior.
