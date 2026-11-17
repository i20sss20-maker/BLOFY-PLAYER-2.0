# Existing BLOFY STREAM console on the BLOFY PLAYER website

Date: 2026-11-17

## Primary destinations
- Original full operator panel: `https://blofyplayer.com/admin/control-center` or `https://blofyplayer.com/operator`.
- Original STREAM operator APIs and protected video previews: `https://blofyplayer.com/operator/api/*`.
- Original reseller login and its separate permissions: `https://blofyplayer.com/distributor`, `/distributor/api/*`.
- Previous read-only HTTP monitoring pilot: `https://blofyplayer.com/admin/control-center/health`.
- Original Railway panel `https://blofy-stream-api-production.up.railway.app/operator` is intentionally NOT removed or modified in its existing authentication flow.

## How it works

The original STREAM control-plane remains the sole source of truth for library, episode queue, source state, subscriptions, codes, reseller accounts and stream actions. We do **not** copy the data, deploy a second catalog, or reimplement the original ~400 KB UI.

The BLOFY activation website's existing signed administrator session authenticates the operator panel under the same website origin. A server-side streaming proxy uses its own token to call the existing Railway STREAM operator endpoint. The browser never receives this token; `/operator/api` stays same-origin for fetch and Range video playback.

The reseller UI remains independent: `blofy_dist` is the only forwarded session cookie, scoped to `Path=/distributor`; no `blofy_admin_session` cookie is sent to STREAM. A genuine same-origin browser POST is required before its Origin is rewritten to STREAM's fixed operator host for the backend's existing CSRF guard.

## Secrets

- Existing STREAM `BLOFY_STREAM_ADMIN_TOKEN`: **must not change** (old Railway operator login remains valid).
- New `BLOFY_STREAM_OPERATOR_PROXY_TOKEN`: independently generated, high-entropy >=40-character value, set identically on STREAM API service and BLOFY activation portal. Never place it in the browser, GitHub source, URLs or logs.
- Setting the token with `skipDeploys:true` alone does not activate it in existing containers. Both services must be deployed after code changes.

## Scope and gates

- All operator read/write operations still call their **existing** backend handlers and validation; do not bypass upstream authorization, source rights, quotas, or audit controls.
- Proxy only allows `/operator`, `/operator/api/*`, `/distributor` and `/distributor/api/*` on a pinned HTTPS upstream. No generic reverse proxy or arbitrary URL.
- Website administrator signed cookie is checked on each operator request, including Range requests. Non-GET operator requests additionally require matching Origin.
- Cross-project traffic travels via HTTPS, which incurs public egress; account for streamed preview bandwidth.
- Reject upstream HTTP redirects and never forward Basic-auth challenges to browser.
- Do not change service DNS, Xtream streaming origins, customer codes, or any actual subscriber playback URLs.

## Verification checklist

1. STREAM branch tests including `isolated-stream/test/operator-dashboard.test.mjs` are green.
2. Website `npm run check` and all affected activation/admin CI test jobs are green.
3. STREAM deployment SUCCESS with new credential accepted and legacy credential still accepted.
4. Website deployment SUCCESS, with `/health` green.
5. Anonymous `/operator/api/overview` and `/operator/api/state` return HTTP 401, and anonymous `/operator` returns original admin login page.
6. Signed admin session can open `/admin/control-center`; browser loads data and POST action with same-origin Origin, with no Basic prompt.
7. Reseller login/issue/renew flows use separate scoped cookie; an off-site Origin is 403.
8. Test a licensed sample video with Range 206/Content-Range behind website proxy. Confirm no customer-facing streaming change.
9. Confirm Railway original `/operator` remains accessible exactly as before.

## Rollback

Repoint `blofy-activation-portal` to previous pinned commit and redeploy. The original STREAM operator and subscriber services remain unaffected. The new STREAM proxy credential can then be removed by approved maintenance after verifying there are no active website proxy sessions.
