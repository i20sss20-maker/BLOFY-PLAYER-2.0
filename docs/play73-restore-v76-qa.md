# BLOFY PLAY-73 recovery candidate

Source of truth: `baseline/play-signed-2000073` at `a9a11011806b22a21475c45554960de045e5b9a0`.
The exact original source is preserved at `restore/google-play-2000073-20261102`.

This candidate is **based on the actual 73 baseline**, not on `main` or the prior 75 experimental cinematic branches. It changes the Play version code only to prepare an upgrade-safe future release (2000076), adds TV launcher resources and explicit remote focus paths, and an opt-in independently installable `.qa` debug variant.

### Unchanged from Play 73
- Original in-app BLOFY logo, theme colors, Home background and layouts.
- Xtream API, catalog streaming parser, player engines, preferred transports, local library, settings and activation credentials handling.
- Production package `tv.blofy.player.v2` and signing contract.

### Release guardrails
- The CI artifacts are **debug QA builds only**; they are not signed Google Play release builds and are not uploaded to Play or the public downloads page.
- Do not publish until full Android TV 9 and modern Google TV D-pad checks, actual playlist import from the approved legal test source, playback, same-device upgrade with preservation of activation/data and complete Google Play review pass.
- Catalog loading errors in an emulator alone do not establish a regression in 73. Investigate server-side failures separately; do not switch an owner's playlist host or remove user data without evidence.
- Production R8/FFmpeg signed AAB needs a separate release workflow and original keystore fingerprint verification.
