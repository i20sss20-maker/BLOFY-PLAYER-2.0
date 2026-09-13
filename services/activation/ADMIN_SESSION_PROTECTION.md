# Durable administrator sessions

Administrator logins previously counted attempts in a process-local map, and
logout cleared only the browser cookie. A copied cookie remained usable until
expiry. The session adapter now stores login counters and session registrations
in the existing PostgreSQL database.

- Twelve login attempts per client in fifteen minutes, shared across instances.
- An additional account budget of 120 attempts per fifteen minutes bounds rotating
  clients and the number of new counter rows. Denied attempts do not extend a lockout.
- A successful login registers a random session before returning its cookie.
  Every cookie-authorized admin request checks that registration; there is no
  positive authorization cache. Logout deletes only that session before returning
  success, so a copied cookie fails on other instances and after a restart.
- Only domain-separated keyed hashes of scopes, client identifiers and nonces are
  stored. Cookies and passwords are not written to either new table.
- Existing credential rotation, eight-hour expiry, HTTPS cookies and origin checks
  remain. v2 cookies require one new administrator login after deployment.
- Database failure returns a generic 503 for login and cookie authorization. Logout
  does not report success or discard its cookie when revocation cannot be recorded.
  Existing valid bearer API clients and unrelated customer routes bypass this store.

The additive tables are `admin_login_limits` and `admin_web_sessions`. A PostgreSQL
advisory transaction lock serializes schema initialization across cold starts.
Atomic UPSERTs serialize counter consumption. Bounded expiry cleanup skips rows
locked by other transactions. No new service, production secret or environment
variable is required. The account-wide budget can temporarily block new admin
logins during sustained attacks; existing sessions and bearer administration keep
working.

The hook tests retain credential rotation, CSRF, parser, cookie, routing and expiry
coverage and add shared-store/replay/failure cases. The required isolated CI job
uses PostgreSQL 16 and independent Node HTTP processes to verify concurrent limits,
schema creation, expiry recovery, restart persistence, logout replay and database
failure. Its database URL must be local and end in `_test`; it uses generated
administrator credentials and a fresh random schema, then removes only that schema.

Run the database suite with a dedicated local test database:

```sh
node --test test/admin-session-persistence.runtime.mjs
```

Set `BLOFY_TEST_DATABASE_URL` locally without logging credentials first. Unit tests
run through `npm test`. Do not infer PostgreSQL runtime success from the unit doubles.

This change is based on deployed website source `c68daaf73320165d6c381a99ad5b2458f848c8c1`.
Android source, player engines, theme, playlists, entitlements and primary update
selection are unchanged. Android rc07.43 was independently verified by
[signed run 34739711821](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/34739711821)
on source `23c7c74b12ec3a453505243be727ecae82c7e0a5`: the signed in-place upgrade,
encrypted data recovery and standalone Login checks passed. Its released APK SHA256
is `9a9a26e227f54fd35cd7722bfe538175b9074d55fe8094164b4228949b2f50ed`.

Source/download separation, MFA, prior deployment exposure and the deferred history
audit remain separate work. Physical receiver and real-provider checks still apply
to the optional Android candidate; this is not a claim of complete protection.

References: [PostgreSQL 16 atomic UPSERT](https://www.postgresql.org/docs/16/sql-insert.html),
[Vercel client request headers](https://vercel.com/docs/headers/request-headers).
