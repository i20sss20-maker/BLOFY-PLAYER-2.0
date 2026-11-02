# BLOFY PLAYER — three independent login paths

## Owner-approved UI labels (exact)
- **BLOFY (كود)**: new, separate code-only entry. Dedicated host **not yet provided**; do not send codes to any existing server.
- **STROING 8K**: formerly “مشتركو BLOFY”. Existing username/password subscriber flow, original production activation base URL, and original subscriber backend remain unchanged.
- **Xtream**: existing manual host/username/password entry, unchanged.

## Safe current scope
The new code entry is **UI-only** until the new host and its real API contract are supplied. Pressing submit with a nonempty code must show a clear not-configured message, not fabricate authorization. There is **no automatic association** yet and no change to installed accounts, playlists, API routes, identities, or playback. Existing legacy saved names are display-only rebranded, not migrated.

## Owner input still required
1. Dedicated BLOFY code-host base URL (HTTPS preferred).
2. Whether it exposes a redemption API or an Xtream-specific code endpoint, with documented request/response examples.
3. Exact code format, expiry/invalid-device behavior and whether redemption is one-time or repeatable.
4. Device binding rules, reactivation/renewal behavior, expected number of devices, and test code.
5. Whether redemption returns a playlist URL directly or a signed short-lived token that the BLOFY activation backend resolves server-side.

## Implementation gates after host arrives
- Keep host/credentials separate from all old STROING 8K / Xtream paths.
- Support remote code validation with bounded timeouts, non-leaky errors, retry, accessible TV keyboard and correct D-pad focus.
- Avoid secret material in logs, URLs, screenshots, analytics or saved plaintext. Never hardcode the new host's master credentials into the app.
- Provision the returned authorized playlist using the existing catalog/provider integration **without modifying player/Media3/VLC/FFmpeg or playback transports**.
- Test invalid/expired/blocked codes, reconnect after restart, TV remote, Android 9, offline fallback and saved account preservation.
- Require owner testing and signed APK checks before publishing. Production website/Play builds are not changed by this branch.
