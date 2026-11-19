# BLOFY STORE PRO — separate reseller gateway

## Architecture

- Reseller login: `GET /distributor` with its own JavaScript/CSS.
- Scoped same-origin POST API: `/api/v1/store/reseller/{command}`.
- Server-side fixed internal bridge: `/internal/blofy-stream/distributor/{command}`.
- Source of truth: `stream-distributors.mjs` (primary PostgreSQL): independent
  distributor credentials, hashed sessions, credit ledger, owned issuance,
  renewal and customer directory. The new UI does not duplicate that ledger.
- Owner controls remain in BLOFY ONE, especially `/one#one-distributors`.

**This is NOT a second public owner admin panel.** Resellers cannot call owner
admin routes from this browser API. They receive only their scoped record data.

## Security

- `__Host-blofy_reseller`: Secure, HttpOnly, SameSite=Strict, Path=/,
  12-hour session maximum. Tokens are never put in HTML, JS, localStorage
  or sessionStorage.
- Require explicit first-party Origin, JSON POST, `X-BLOFY-Reseller: 1`.
- Command allowlist; no arbitrary proxy URL/route or browser bearer forwarding.
- The server-only `BLOFY_STREAM_UNIFIED_BRIDGE_KEY` is never returned to clients.
- Rate-limited login and API usage; require reverse proxy/WAF rate limiting
  across replicas and monitor authentication failures.
- Sensitive reveal/issue responses use no-store/private and no-referrer.
- No permission to alter customer checkout, discount, Geidea payment state,
  main commercial stock, sources or other distributors.
- Old distributor user/password combinations remain valid; owner manages
  credentials and credits from the existing BLOFY ONE flow.

## Production prerequisites

1. Ensure `BLOFY_STREAM_UNIFIED_BRIDGE_KEY` exists on the activation service.
   A missing bridge key blocks all commands (HTTP 503). Do not paste this key
   into a website or share it with reseller accounts.
2. After automated CI passes, deploy the branch to a private test environment
   before updating the Railway production branch.
3. Create a non-production reseller with a small test credit allocation in the
   existing BLOFY ONE panel. Verify:
   - valid and invalid sign-in, logout, page reload, 12h session expiry;
   - one STREAM and one Xtream issuance with credited debits;
   - idempotent retry, customer ownership, code reveal, renewal and re-login;
   - a second reseller cannot reveal or modify the first reseller's record;
   - admin routes reject reseller sessions; checkout and paid-order fulfillment
     still work independently.
4. Inspect mobile browser layout on iOS Safari and Android Chrome.
5. Require a distinct real-device load/performance test before calling the
   mobile experience production-validated.

## Rollback

Production remains on its existing Railway source branch unless explicitly
promoted. To roll back after promotion, return the activation service to the
previous verified branch/commit. Existing reseller tables and sessions are not
migrated by this UI; no schema or checkout changes are made.
