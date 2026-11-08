# BLOFY PLAYER — Android TV activation stability and release gate (2026-11-08)

## Customer experience
The customer opens BLOFY, scans the existing QR code, activates from a phone, and the TV automatically enters the active provider. A 6-digit code and device ID remain visible if the phone cannot scan. This release must not change artwork, payment/subscription state, or customer playlists. Do not make refresh or clock/language changes mandatory.

## Safeguards already implemented on this QA branch
- Activation check is authoritative; no offline or local code bypasses a blocked/expired subscription.
- Automatic pairing checks in the background only while Login is on screen. Network failures retry with bounded backoff; 429 is delayed further.
- A first-party Railway hostname is only a fallback for primary DNS/TLS errors; normal certificate and hostname verification remain enabled.
- A verified short activation lease uses server time plus Android elapsed time within the same boot. It is not an unlimited license or a universal fix for incorrect RTC during TLS handshake.
- The existing server-issued identity persists for installed users until the server approves migration. New installs derive identity from the app-scoped Android ID where available. **Factory resets, device replacement, signing-key changes, and certain broken Android IDs can still change identity**; support/admin must safely rebind the entitlement.
- Website playlists are pulled without overwriting the customer's local playlists; failed sync is distinguished from failed activation.
- The internal updater validates installed package name, higher version and matching signing certificate before requesting installation.

## Automatic gate (GitHub Actions)
The workflow named **BLOFY 55.8.8 easy QR pairing signed test APK**:
1. Runs activation, identity, clock and pairing diagnostics unit tests.
2. Builds the release APK with the pre-existing signing identity.
3. Verifies application ID, version, non-debuggable signing certificate, ZIP alignment and SHA256.
4. Uploads a private test artifact. It **does not publish to the customer download website or Play Store**.

## Device acceptance checks — require physical/Android emulated devices
Mark PASS/FAIL with device model, Android API, network type, app version, time and sanitized support code. Minimum matrix: Android 9 TV box (API 28), Android TV 10–14 where accessible, current Android phone, different screen widths, both Arabic and English, D-pad only.

1. Fresh install opens QR and 6-digit code immediately without relying on portal/playlist success.
2. Phone pairing on another network updates the TV without pressing Refresh or Enter.
3. Existing activated subscriber enters without losing their activated status or cached catalog.
4. Expired, blocked and trial states agree with the server. An expired subscription is never unlocked locally.
5. Invalid device wall clock: QR remains visible; TLS errors have a support code, not a bypass; if TLS verification cannot succeed the user gets a recoverable error.
6. No Wi-Fi, DNS failure, HTTPS handshake error, 429/503, and 20-second latency: no crash; backoff; retry when network returns. Codes have no secrets.
7. Playlist sync fails after activation: the status describes playlist retry and existing playlists remain preserved.
8. Kill/restart app, reboot TV, reinstall signed APK, switch language, press D-pad across all relevant controls.
9. Upgrade in place from 55.8.7: original certificate, package name, installed subscriptions and saved playlists must be preserved.
10. Verify download resumes/fails cleanly, package signature matches the installed signing identity, and installer permission flow works on Android 9.

## Staged rollout and rollback gate
- **Do not** merge or publish on build success alone. Obtain a successful Android 9 installation + QR pairing + existing subscriber regression first.
- Release to a small internal group, watch activation error codes and crash metrics for 24 hours, then increase in stages if regression-free.
- Keep last stable signed APK and update manifest version retained for recovery. On regressions halt the updater's offered version and restore the prior update manifest. Android does not normally permit installing a lower version over a higher version, so rollback on-device may need a *new higher-version hotfix* with the old stable code.
- Rollback must not delete the Room database, activation row or pairing identity. Never rotate signing identity during recovery.

## Support codes (non-sensitive)
E-A01 DNS · E-A02 HTTPS/TLS · E-A03 timeout · E-A04 network connection · E-A05 upstream/service · E-A06 rate limit · E-A07 rejected/unavailable route · E-P01 playlist sync · E-A99 unexpected.
Codes identify *categories* only, not a precise cause; support investigates server-side logs and exact device setup. Do not put playlist URLs, user identifiers, six-digit activation codes or tokens into telemetry.

## Remaining blockers before broad release
- Human/emulator verification of Android 9 and wrong-clock TLS behavior.
- Safe entitlement rebind for actual factory-reset devices needs server-side account verification.
- Confirm update-site manifest can be rolled back without silently downgrading customers.
