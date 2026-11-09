# BLOFY PLAYER 55.8.7 — two distribution channels (not yet live)

## Annual-only catalog

- FREE: SAR 0, no subscription checkout.
- PRO: SAR 19/year; Google Play product ID `blofy_player_pro`, yearly base plan to be configured in Play Console.
- VIP: SAR 49/year; Google Play product ID `blofy_player_vip`, yearly base plan to be configured in Play Console.
- The same plan names/prices are targets for the website checkout; Play checkout must use live Play ProductDetails/localized prices, not hardcoded values.

## Channel separation

- Build using `-PBLOFY_DISTRIBUTION=play` to embed `BuildConfig.IS_GOOGLE_PLAY=true` and use the Play-specific AndroidManifest.
- Build using `-PBLOFY_DISTRIBUTION=website` to embed `BuildConfig.IS_GOOGLE_PLAY=false`.
- The UI displays which payment method would be used and **never provides an external purchase link from a Play build**.
- Both channels currently **disable checkout**. Purchase buttons must remain disabled until the full safe purchase path works.
- External website checkout must not be opened from Play builds except under an approved eligible alternative-billing program.
- Never depend on Android installer package detection to choose checkout channel.

## Required backend design (not implemented)

1. Shared BLOFY account/device link and server-owned entitlement record: principal ID, plan, verified source, verified purchase ID, status, expiry, refund/revocation status.
2. Play client: BillingClient products and annual base plans; purchase token sent to backend; backend uses Google Play Developer API to verify, acknowledge as appropriate, and maintain state with Real-time Developer Notifications.
3. Website client: creates secure backend session and redirects only website-distributed builds to an approved payment provider; backend verifies signed payment notification and renewal/expiry events.
4. Idempotent purchase handling, refund/chargeback reconciliation, restore purchases, expiration and upgrade path without double-paying.
5. Do not unlock PRO/VIP on any client-only response. Avoid storing raw provider credentials or sensitive billing tokens in logs.
6. Do not bundle unlicensed media; VIP content requires verified redistribution rights and explicit store disclosures.

## QA release safety

- Keep 55.8.7 player functionality, activation and prior subscriptions unchanged.
- Test package identifiers, BuildConfig values, offline/restore/expired cases on Android 9 TV and mobile.
- Confirm Play product prices and renewals in Play Console before enabling subscriptions.
- Never distribute test APK from an unfinished branch as a production auto-update.
