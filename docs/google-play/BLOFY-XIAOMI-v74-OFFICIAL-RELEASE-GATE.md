# BLOFY 74 — Google Play Console + Website release gate

## Exact user-selected source
- Git tag `xiaomi-v74-android9-owner-test-20261026`, source commit `1190f118583212900846c254c3219aba4d2b6387`.
- The user's current standalone Xiaomi package is `tv.blofy.player.xiaomi`. The official Android/Google Play listing is a **different** package `tv.blofy.player.v2`. Both APKs can coexist; installing the official variant does not automatically migrate data from the Xiaomi standalone app.
- The official candidate is assembled from the **same Xiaomi v74 source** with `-PBLOFY_XIAOMI_EDITION=false` and the original BLOFY release certificate.
- User-facing `versionName = 2.0.0-rc07.55.6` (BLOFY **74**). Internal `versionCode = 2000080` because 2000074 has already been uploaded to Google Play and may not be reused even after removal; 2000080 is intended to upgrade website 2000075 and earlier without uninstall. **Confirm that 2000080 is unused in Play Console; the repository cannot prove this.** Choose a higher code if necessary. Play signing/app signing must also match the existing application.

## TV review fixes
- Real `app/src/main/res/drawable-xhdpi/blofy_tv_banner.png` 320 x 180; visibly contains the BLOFY PLAYER title, not a decorative XML placeholder.
- Equivalent nodpi bitmap as fallback, no textless XML banner.
- Keep original `blofy_logo.png` 512 x 512 and give the brand logo a contrasting tile on TV login.
- D-pad Up/Down/Left/Right travel between playlist action row and header in LTR and RTL. Check each menu, player transport, search and modal on a physical remote.
- Both `MAIN` + `LEANBACK_LAUNCHER` in merged AndroidManifest; TV Android 9 emulator test.
- Original Media3, FFmpeg and VLC playback left intact; ensure both armv7/arm64 and 16KB native page alignment on Play candidate. Do not call the release Play-compliant before testing this.
- Google Play-only manifest must not include `REQUEST_INSTALL_PACKAGES`.
- Native version of TV app must not crash on resume, navigation, library sync or failed network.

## App access for Google review
- App uses Device ID and 6-digit pairing, **not** an email/password.
- Reviewers must be able to access a legitimate seeded demo playlist after activating the review device, without payment. Supply exact actionable steps and a test activation path in **App access** in Play Console. Never publish a real user's tokens in this file or store listing.
- Play Store requires truthful data safety/privacy policy/contact information, accurate TV screenshots, content ratings and appropriate rights for streamed content.

## Website gate
- Current website versionCode `2000075` and the public `/download/latest.apk` must not be switched to a Xiaomi standalone package; that would install a **second app** and cannot update official users.
- Once owner verifies the signed **official application ID** APK and real playback, upload the website artifact and update the public release metadata to **versionCode 2000080** and **versionName 2.0.0-rc07.55.6**, using the exact signed download URL.
- Publish Google Play AAB **only after** checking Console code availability, store app-signing certificate, Android TV reviewer checklist and confirming the hardware works.
- Do not delete users' data or downgrade an installed version 75/76/77/78. No production site/Play update until these release gates are satisfied.
