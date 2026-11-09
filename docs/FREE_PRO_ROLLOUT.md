# BLOFY FREE + PRO rollout (development branch)

## Phase 1 implemented
- Adds free local playlist entry to existing Android TV and phone login screens, without removing legacy device pairing.
- User can run a personally supplied Xtream/M3U list using local catalogue cache or existing catalogue loading.
- Saved but inactive local playlists are selectable.
- Manually supplied playlists are not pushed to the BLOFY activation portal unless an existing active legacy activation is present.
- No production release, in-app purchase or PRO entitlement is enabled yet.

## Manual validation required before release
1. Fresh installation (Android 9 TV, newer TV, Android phone): skip pairing; add personal M3U / Xtream; launch playback.
2. Relaunch app: verify saved provider and playback; verify live/VOD and error handling.
3. Verify TV D-pad focus, Back behavior, screen rotation and remote text entry.
4. Existing paired customer: confirm legacy activation, provider sync and existing subscription behavior are unchanged.
5. Expired/blocked devices: free user-provided playlists should remain accessible; BLOFY-managed entitlements must not be bypassed.
6. Confirm review-team access instructions for all paid/locked flows; ensure no embedded unlicensed media or credentials.
7. Verify source credentials never leave device in FREE path, except requests to the user-supplied media server.
8. Build and test signed Android App Bundle with production certificate and the correct next versionCode before any Play submission.

## Phase 2 not implemented
- Real PRO entitlements and backend account mapping.
- Google Play Billing purchase flow, server-side purchase verification, acknowledgements and restoration.
- Feature gating, limits and migration rules for current customers.
- Subscription settings and compliant Google Play review access.

Do not market or publish PRO as an active paid plan before these are implemented and tested.

## Phase 2 groundwork added (not a paid release)
- The `ProAccessPolicy` feature matrix keeps free playback, search and favorites available without PRO.
- All premium features default to DENIED unless a verified, active, unexpired app-PRO entitlement is supplied.
- Added JVM unit tests for free access, expiry, inactive status, unverified state, and invalid product.
- PRO preview now shows the current FREE status and explicitly does not offer purchases.

### Required before billing rollout
- Configure Play Console subscription product IDs and base plans.
- Integrate Play Billing only after choosing products; validate purchase tokens server-side with Google Play Developer API.
- Secure account/device ownership and server-to-server entitlement checks; never trust a self-asserted client boolean.
- Acknowledge purchases, support restore, cancellation, refunds and pending purchases.
- Add device migration compatibility for existing legacy subscribers and approved store-review access.
- Add feature gating to each real premium feature only after the feature is built and tested.
