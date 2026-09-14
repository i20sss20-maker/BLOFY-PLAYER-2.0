# BLOFY centrally managed direct connections (rc07.17)

The user approved username/password-only subscriber login with a centrally managed
host and direct device-to-provider catalog and playback requests. The host is hidden
from the normal app/portal forms. It is delivered to the authenticated device and is
not claimed to be secret against device inspection.

## Contract and compatibility

- `POST /api/v1/subscribers/session` accepts `delivery: "direct"` from new clients.
  Successful device/PIN and provider authentication returns `delivery`, `baseUrl`,
  real `username`/`password`, and an opaque `sessionToken`, plus the stable provider ID.
- Omitting `delivery` preserves the legacy proxy response. Existing portal saves and
  older clients remain compatible; legacy playback authorization is unchanged.
- `POST /api/v1/subscribers/resolve` accepts device ID/PIN and up to 20 session tokens.
  Only authenticated envelopes belonging to that same active device can return a
  direct connection. It does not contact the upstream provider. Expired envelopes
  may recover that device's saved credentials; expired envelopes still cannot
  authorize legacy proxy playback. All responses are `no-store`.
- The current `BLOFY_SUBSCRIBER_HOST` is read when resolving connections. After a
  central host change/redeploy, **Refresh from website** obtains the new configuration;
  ordinary direct cached startup does not wait for a configuration network request.
- The portal continues storing encrypted proxy descriptors, never a new direct-host
  row. This retains account deduplication/IDs, website editing, and old-client support.
  Subscriber tokens up to 4096 characters are saved without truncation.
- Android requires HTTPS to the BLOFY service and does not follow service redirects.
  Direct provider URLs retain the existing public HTTP/HTTPS compatibility policy.

## Existing installations

Database v11 -> v12 adds one empty-default `subscriberToken` column. The token is
included in the existing storage encryption and exact-ciphertext cache.

On subscriber connect, import, or website sync, legacy rows belonging to the configured
BLOFY gateway are resolved. The Room transaction verifies the old source still matches,
updates connection fields and cached proxy artwork/media URLs, and retains provider IDs,
stream rowids, ordering, favorites, locks, watch state, and catalog readiness. Raw proxy
URLs from older session tokens are also rewritten. Unrecoverable signed proxy direct
links are cleared so the unchanged Xtream URL builder can construct the content URL.
Disposable detail metadata is cleared before commit to remove cached proxy artwork.

Account edits and later host changes still use the existing staged replacement flow.
A pending account must not replace a working catalog until the existing integrity checks
accept it. No playback engine, fallback policy, theme resource, or codec library changes.

## Verification and rollout

Run Android unit/Room tests and lint, activation unit tests and syntax checks, and the
activation CI HTTP/Postgres suite. The latter checks a long-token portal round trip,
direct resolution and fixture HLS playback, and the unchanged legacy proxy flow.

Deploy the tested backend revision before installing rc07.17. Verify `/health` and
`/api/v1/subscribers/health` (`directConnections: true`) and that unauthenticated resolve
requests cannot obtain credentials. Keep PR #46 draft and unmerged.

Device acceptance must cover existing-subscriber upgrade, fresh subscriber login,
website-created subscriptions, Live TS/HLS, movies, series, cached restart, and website
refresh. Local fixture playback is not evidence that the real provider accepts playback
from the user's device. The earlier gateway HTTP 511 result remains historical evidence,
not proof that direct playback will succeed.
