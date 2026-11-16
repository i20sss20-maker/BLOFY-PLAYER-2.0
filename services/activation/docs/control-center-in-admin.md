# BLOFY CONTROL CENTER on existing BLOFY website

Date: 2026-11-16. Implementation branch: `feature/control-center-in-admin-20261116`, based on the actual Railway activation portal branch `qa/stream-timeline-keep-arabic-audio-20261115`.

This integrates a **read-only** monitoring page at `https://blofyplayer.com/admin/control-center` into the existing administrator website and adds a navigation link under `/admin`.

## Security

- Reuses the exact `blofy_admin_session` signed-cookie authentication from `src/admin-session-hook.mjs`.
- The page, its stylesheet and JavaScript, and the status JSON all require a valid signed admin session.
- A failed session sees the existing admin login page (assets/API return 401).
- No new admin credentials or secrets are introduced, and there is no cross-origin browser fetch.
- The backend fetches only four hard-coded HTTPS `/health` URLs. No user-supplied target URL, no writes or account changes.
- Requests have a 4.5 s timeout and 25 s server-side cache; latest status only (bounded in-memory history).
- The existing CSP restricts scripts, styles and API calls to the BLOFY domain.

## Verification

From `services/activation`:

```bash
npm run check
node --test test/admin-control-center.test.mjs
```

Before deployment, verify unauthenticated GETs to `/admin/control-center/app.js`, `/admin/control-center/style.css`, and `/api/v1/admin/control-center/status` all return 401. `/admin/control-center` must show the existing login page. Once logged in, confirm navigation, real HTTP results and logout behaviour.

The dashboard reports only HTTP reachability; it does not claim channel playback, audio repair, failover or complete Xtream data synchronization.

## Rollback

Revert the integration commits on the portal's branch or deploy the prior portal commit. The separately deployed `blofy-control-center-lab` in `BLOFY-XTREAM-MIGRATION-LAB` is not changed.
