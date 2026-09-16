# BLOFY PLAYER rc07.51 — Play Console Submission Sheet

## App identity
- App name: `BLOFY PLAYER`
- Package: `tv.blofy.player.v2`
- Version name: `2.0.0-rc07.51`
- Version code: `2000062`
- Distribution start: Internal testing
- App type: App
- Primary purpose: Media player / user-provided media playlists
- Content statement: BLOFY PLAYER does not include or sell channels, movies, series, or a content subscription. Users add only sources they are authorized to access.

## Privacy and deletion
- Privacy policy URL: `https://blofy-gateway.mangotree-58d162b9.uaenorth.azurecontainerapps.io/privacy`
- Data deletion URL: `https://blofy-gateway.mangotree-58d162b9.uaenorth.azurecontainerapps.io/privacy#privacy-form`
- In-app deletion: Account & Privacy screen -> Delete device data.
- Diagnostics: optional and off by default.
- No advertising ID use for activation; no IMEI request; no location/camera/microphone/contacts permissions in Play build.

## Billing / monetization declaration
- Google Play build is consumption-only.
- It does not display license plans, pricing, checkout, or an external payment button.
- Existing license status and recovery may be used.
- Player license is separate from content and does not include media.

## App access for review
Use `docs/google-play/app-access.md`.
Reviewer M3U:
`https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/docs/google-play/reviewer-sample.m3u`
No customer credentials are required. The sample uses Apple's public developer HLS test stream.

## Store listing
Use `docs/google-play/store-listing.md` for Arabic and English copy.
Upload only real screenshots captured from the final Play build. Do not use generated screenshots that show controls/content not present in the app.
Android TV launcher banner is embedded as the xhdpi `blofy_tv_banner` resource with BLOFY PLAYER branding.

## Data Safety
Use `docs/google-play/data-safety-inventory.md` as the source of truth. Do not declare “no data collected.”
Important categories to review in Console against Google's current wording include device/account identifiers used for activation, optional diagnostics, user-entered phone number in the portal, user-provided playlist/provider information when cloud/portal management is chosen, support/security records, and deletion/retention behavior.

## App signing — DO NOT GUESS
If preserving update compatibility with BLOFY APKs distributed outside Google Play is required, the Play **app signing certificate** must remain compatible with BLOFY's existing production app signing certificate. Do not accept an irreversible key choice until Play Console shows the certificate setup and it has been compared with the production certificate expected by release CI.
Do not paste/export the private key or passwords into chat or documentation.

## Technical release gates
Before uploading this version:
- Google Play preparation checks: green.
- Android CI: green.
- FFmpeg/native packaging verification: green.
- Production-Signed Test: green on the frozen Play-final head.
- Use only the AAB artifact from that final successful signed run.
- Confirm AAB/package/version/certificate checks from CI.

## Console/account-specific fields
These cannot be safely guessed in source code and must be read from the actual Play Console account:
- Developer/public support email and phone/website where required.
- Developer account type and any account verification steps.
- Exact content rating questionnaire answers.
- Target audience / age groups chosen by the owner.
- Ads declaration (based on final app behavior; app source contains no ad product in the audited Play build).
- Whether the account is subject to a mandatory closed-testing period before production.

## Release sequence
1. Configure app identity and app signing carefully.
2. Complete Store listing, App access, Privacy, Data Safety, Content rating, Target audience, and required declarations.
3. Upload the frozen Play-final AAB to Internal testing.
4. Install from the Play-generated build on phone and Android TV and smoke-test activation, playlist add, playback, remote navigation, privacy/deletion access, and update behavior.
5. Read Pre-launch report and fix any real blocker before wider testing.
6. Move to closed/open/production only when the account's Console requirements and BLOFY physical smoke tests are satisfied.
