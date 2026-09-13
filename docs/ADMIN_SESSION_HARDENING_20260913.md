# Admin session hardening — 2026-09-13

Website baseline: 079fde576fe9d8783ecee8cfcd6405d3060c16c1.
This is an independent website-only fix, not the previously blocked Android/history-scanner change.
Only the admin-session runtime hook changes. No Android, player, activation, subscriber, playlist, release catalogue, APK, signing-key, database-schema or theme changes are included.

Changes:
- Domain-separated HMAC sessions bind to all configured admin credentials. Re-deploying a changed password invalidates prior sessions on that deployment. One new admin login is required after first deployment; customer activation is unaffected.
- Strict session version, issue/expiry timestamps, eight-hour maximum lifetime, nonce and input-size checks. Up to thirty seconds of clock skew are tolerated for issue time.
- Exact HTTPS Origin checks for deployed admin mutations. Existing loopback HTTP integration stays available only outside Vercel/non-production. Arbitrary Authorization text no longer exempts authenticated cookies from a missing-Origin check. Real bearer API clients remain supported.
- A hard 2,000-entry cap for the existing instance-local login limiter; active counters are not evicted to make room for new identities.
- Byte-bounded JSON decoding preserves split UTF-8 credentials and rejects non-object bodies.

Validation scope: nineteen new Node tests execute the real hook with generated test credentials, including a real loopback HTTP login/API/CSRF/logout test. A comparison run on the exact previous source demonstrates the old failure cases. CI additionally runs existing service unit/PostgreSQL and admin/device integration tests. Check actual run results before deployment.

Remaining limitations, not solved here:
- Login budgets remain instance-local, not a distributed persistent brute-force control.
- Logout removes the browser cookie; an already copied token is not individually revoked server-side until expiry or credential rotation. Durable session revocation and MFA remain separate work.
- Old deployments with old code/credentials must be protected or retired independently; a new deployment cannot invalidate their configuration snapshots.
- Source is still public, Android R8 and secret-history scan are still pending. This patch is not complete application protection.
