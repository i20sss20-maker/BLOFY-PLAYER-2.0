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

The device-test baseline is `2.0.0-rc07.9` (`versionCode 2000017`), commit `72434a500946286b84e9c779fb44e02d6052144c` on `rc07-commercial-stability`. Signed Release #257 passed. The production activation and playlist portal is connected at <https://blofy-player-2-0.vercel.app>.

Current work audits and fixes this baseline before a commercial release. See [project memory](docs/PROJECT_MEMORY.md) for the current scope and protected playback/theme boundaries. Passing CI does not replace the real-device acceptance test.

The canonical clean-rebuild package is `tv.blofy.player.v2`, so it installs beside the legacy application. See [the Arabic final reference](docs/BLOFY_2_FINAL_REFERENCE_AR.md) and [the 7 Max parity checklist](docs/SEVEN_MAX_PARITY_CHECKLIST.md) before changing playback, catalog replacement, or TV focus behavior.
