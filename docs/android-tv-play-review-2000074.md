# Android TV Google Play review repair (candidate 2000074)

## Source baseline
- **Exact production-signed source:** `a9a11011806b22a21475c45554960de045e5b9a0` (AAB versionCode `2000073`).
- **Proposed candidate:** `2000074`, package `tv.blofy.player.v2`; signing identity and playback engines must remain unchanged.
- The repository's `main` branch is **not** the same code as the Google Play signed source. Compare/review this branch against `baseline/play-signed-2000073` instead of rebasing on `main` without a migration audit.

## Google rejection: launcher branding
- Replaced shape-only banner with **title-bearing** `drawable-xhdpi/blofy_tv_banner.png` at **320 × 180 px**, with `BLOFY PLAYER` rendered in the pixels.
- Removed the obsolete shape-only default drawable that would be selected on some density configurations.
- Reuses the existing official `512 × 512` PNG blob as `mipmap-nodpi/blofy_tv_icon.png`; both production and non-Play manifests refer to it.

## Google rejection: D-pad
- Live catalog now requests focus on the first category after a successful category update; previously the focus initializer excluded `KIND_LIVE`.
- TV login's refresh and saved-playlist controls now have explicit vertical remote focus links, updated when lists change. Center click remains delegated to normal Android click handling.
- **Required device QA, not yet verified:** On Android TV 9 and recent Google TV builds, run entirely without mouse/touch and verify: activation; QR pairing; manual sign-in; all lists; Live/Movies/Series; details; settings; Search IME; Player; Back. In long lists verify focus and scrolling. Confirm English and Arabic layouts.

## Google rejection: reviewer login
This rejection cannot be solved with UI assets alone. Before submission, provision a stable and legal **demo account/playlist** that allows Google testers to reach the app's core functionality from any country without manual approval. Provide login instructions in English in **Play Console → App content → App access**. Test the *exact same instructions* on a fresh TV installation and verify they work continuously. Do not commit any reviewer passwords, Xtream credentials, URLs with secrets or subscriber data to GitHub.

## Release gate
- Build `assembleDebug` + `testDebugUnitTest` + `lintDebug` and inspect build artifacts.
- Build a **Google Play variant AAB** with the existing trusted signing key (or configured Play App Signing upload key). Verify final manifest's launcher banner and icon and AAB versionCode.
- Verify the app has no regression in activation, playback, network access, playlist import, Arabic/English focus, and Android TV 9.
- Ensure the candidate versionCode exceeds the highest code already in Play Console in every relevant track (2000074 is a candidate, not a claim about Console state).
- Do not submit until QA and login are complete; keep all existing production installs unaffected.
