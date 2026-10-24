# BLOFYSAT — isolated Geidea test service

This is a **test-only**, password-protected service for the existing Railway project
`BLOFY-Geidea-Sandbox`. It never imports BLOFY activation, subscriber, Xtream, Tap,
Zid, production database, or production bootstrap code. There is no fulfillment
endpoint. A successful payment records sandbox evidence only.

## Current verification — 2026-10-24 (Asia/Riyadh)

The isolated service is deployed at
<https://blofy-player-20-sandbox.up.railway.app>. Railway deployment
`bc6c1e78-f712-4d97-bbd8-968f0e5edcae` reached **SUCCESS**, running application
commit `725cc5e8161a594026209444813cfedf618204ac`. The source is pinned to that
commit; later branch pushes do not automatically deploy. The sandbox-only volume
preserved the first Visa payment across the return-page deployment.

The merchant's Geidea **TEST** credentials were installed only in this service's
Railway variables after explicit owner approval. Actual signed Create Session
requests succeeded. The following are real provider test transactions through
Geidea's hosted checkout, using its official fake cards at **SAR 1.00** each:

| Network | Successful test payment | Decline attempt | Cancellation |
| --- | --- | --- | --- |
| Visa | `Success` / `Paid`; signed callback + authenticated order lookup verified | Final `Failed` / `OrderFailed`; signed callback + lookup verified; not paid | Not tested |
| Mastercard | `Success` / `Paid`; signed callback + authenticated order lookup verified | Final `Failed` / `OrderFailed`; signed callback + lookup verified; not paid | Not tested |
| Mada | `Success` / `Paid`; signed callback + authenticated order lookup verified | Session created; submission not verified | Not tested |

All three successful orders passed exact amount/currency, merchant/reference,
`isTest=true`, capture/refund and successful Pay-transaction checks. Signed
webhooks and authenticated lookups also verified the two final declined orders.
No activation was performed.

**A declined attempt is not necessarily a final failed order.** In the two
observed decline cases, Geidea initially kept the order open for retry with
`InProgress` / `PayFailed` and codes `700` / `527`. Its official
[callback documentation](https://docs.geidea.net/docs/sample-callback-responses)
explains that an in-progress payment journey may have no callback until it is
completed or closed. After the payment journeys closed, signed callbacks arrived
and authenticated lookups confirmed `Failed` / `OrderFailed`. Both decline cases
now satisfy the strict signed-callback evidence matrix. The implementation did
not prematurely mark the in-progress attempts as final failed orders.

Remaining live negative/cancellation cases are **not certified**: the cloud
browser connection stopped responding during Mada decline form entry and also
timed out on its documentation/recovery calls. No further browser submissions
or duplicate creates were attempted after that failure. Complete these cases
when browser interaction is available, then export fresh evidence.

HTTPS health and protected HTTP endpoints were checked. `/health` reports
`mode=sandbox`, `activationsEnabled=false` and the deployed revision. Anonymous
dashboard/order requests return 401. Real Mastercard and Mada checkouts returned
to the new public, static, data-free Arabic return page with HTTP 200. Redirect
query parameters never mark an order paid. The dashboard itself was checked by
authenticated HTTP; full dashboard visual QA remains pending.

**25/25 local HTTP/security tests passed**, including the existing Geidea
preparation/client tests, and the browser JavaScript syntax check passed. These
automated tests use loopback HTTP and synthetic/mocked provider data; the real
test outcomes are separately described above.

This work changes only the sandbox branch/project. It does not merge to `main`,
configure a production domain/database, or deploy customer activation code.

## Railway deployment specification

Use **only** the existing project named `BLOFY-Geidea-Sandbox`. First inspect it
for any existing service/configuration; do not create a duplicate project.

| Setting | Required value |
| --- | --- |
| Source | `i20sss20-maker/BLOFY-PLAYER-2.0` |
| Branch | `feature/geidea-sandbox-20261023` |
| Root directory | `/` (repository root) |
| Configuration | Explicit Railway service settings; no config-file override |
| Dockerfile | `services/geidea-sandbox/Dockerfile` |
| Start command | `node services/geidea-sandbox/src/server.mjs` |
| Public hostname | `blofy-player-20-sandbox.up.railway.app` |
| Health path | `/health` |
| Volume mount | A new sandbox-only volume at `/data` |
| Replicas | `1` |
| Database file | `/data/geidea-sandbox.sqlite` |

Verified resource scope:

- Project: `79ca35ec-906f-4f90-bce0-3acefbe07043` (`BLOFY-Geidea-Sandbox`).
- Environment: `f1937062-5f8b-4e98-868b-d5d275a5ecd9` (`sandbox`).
- Service: `54772809-94dc-4349-9ecf-f8931af1f6d6` (`BLOFY-PLAYER-2.0`).
- Volume: `73c1a1f3-ee50-471b-b6bf-7be18292ebd7` (`geidea-sandbox-orders`, `/data`).

The legacy `railway.toml` is a reference only. Current deployment uses the
explicit Dockerfile/start/health settings above and
`RAILWAY_DOCKERFILE_PATH=services/geidea-sandbox/Dockerfile`; a deprecated
Railway config-file override is not connected.

Keep the Railway source service, environment and volumes in the sandbox project.
Do not copy production variables, point at a production database, attach an
existing BLOFY volume, add a production domain, or merge this branch to enable
testing. The Docker image copies only this service and the two existing Geidea
test-helper modules. It installs no npm dependencies.

### Private service variables

Set these on the sandbox service only. `.env.example` contains names, not secrets.

| Variable | Value / source |
| --- | --- |
| `BLOFY_GEIDEA_TEST_MODE` | `enabled` |
| `GEIDEA_CREDENTIALS_ENVIRONMENT` | `test` |
| `GEIDEA_TEST_MERCHANT_PUBLIC_KEY` | Test public key in Geidea's onboarding email |
| `GEIDEA_TEST_API_PASSWORD` | Test API password in the same email |
| `BLOFY_GEIDEA_ADMIN_TOKEN` | A new random secret of at least 32 characters; different from Geidea's keys |
| `BLOFY_GEIDEA_PUBLIC_URL` | `https://<dedicated-sandbox>.up.railway.app` |
| `BLOFY_GEIDEA_SANDBOX_PROJECT_ID` | The inspected UUID of `BLOFY-Geidea-Sandbox` |
| `BLOFY_GEIDEA_DB_PATH` | `/data/geidea-sandbox.sqlite` |

Railway supplies `RAILWAY_PROJECT_ID`, `RAILWAY_PROJECT_NAME`,
`RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_VOLUME_MOUNT_PATH` and `PORT`.
Startup validates the project name/ID, generated hostname and volume. It fails
closed on copied production configuration or a non-test credential declaration.
The KSA API uses the same host for test and live accounts: these flags cannot
independently identify a credential before a transaction exists. Use only the
test keys Geidea supplied. Reconciliation additionally requires `order.isTest`
to be exactly `true`; a live order cannot be accepted as test evidence.

The amount is hardcoded at **SAR 1.00**; browser-supplied prices and extra input
properties are rejected. No approved customer price is inferred from this amount.

## Private test flow

1. Observe Railway deployment `SUCCESS`, then verify `/health` reports
   `mode=sandbox`, `activationsEnabled=false` and the intended commit revision.
   A successful health check proves local readiness, not Geidea authentication.
2. Open the generated sandbox domain. HTTP Basic username is `sandbox`; password
   is the separate `BLOFY_GEIDEA_ADMIN_TOKEN`. Never put it in a URL or GitHub.
3. Select the intended network/scenario and create a session. The server sends
   the HMAC-signed SAR 1.00 request to Geidea using test credentials.
4. Open the generated Geidea-hosted checkout. Enter only official **test cards**
   on Geidea's page. This app accepts no card-number/CVV request fields and never
   stores raw provider payloads, customer names, masked cards or card tokens.
5. The public webhook validates the callback HMAC, exact amount/currency,
   merchant public key, reference, test flag and order identity. It then retrieves
   that order from Geidea with server-side Basic authentication. An order is
   `paid` only for `Success`/`Paid`, an actual successful Pay transaction and the
   exact captured amount with no refund. A browser redirect never changes status.
6. Use **التحقق من Geidea** for missed/delayed callbacks. This can verify a payment
   via the provider API, but the test matrix stays incomplete without a verified
   webhook. The matrix uses Geidea's observed card brand, not the selected label.
   A rejected attempt can remain `InProgress` / `PayFailed` while checkout allows
   retry; it must not be presented as a paid order or an authenticated final
   failure callback. The exported provider fields distinguish this condition.
7. For another transaction, use **بدء عملية اختبار أخرى**. A retry of the same
   request reuses its idempotency key. Failed/ambiguous creates are retained for
   reconciliation and are never automatically recreated under the same key.
8. Complete success/decline/cancel cases for Visa, Mastercard and Mada and export
   the JSON evidence report. Record any Geidea limitation where cancellation has
   no reported card brand. Such a case remains pending in the network matrix
   rather than being falsely certified.

The last 50 orders and their safe status fields are shown/exported. Orders and
callback receipt hashes persist in SQLite on the separate volume. Keep one
replica; never use ephemeral storage for a deployed payment test.

## Tests

From the repository root with Node 24:

```sh
node --test services/geidea-sandbox/test/*.test.mjs services/activation/test/geidea-preflight.test.mjs services/activation/test/geidea-sandbox-client.test.mjs
node --check services/geidea-sandbox/web/app.js
```

Tests run only against loopback HTTP and injected provider responses. Coverage
includes startup isolation, precision/price tampering, authentication, CSRF,
concurrent duplicate creates, interrupted creates, callback signatures/retries,
wrong merchant/reference/amount/currency, live-order rejection, capture/refund
checks, provider failures, browser-return forgery, network evidence, secret/card
data exclusion and persistence across restarts.

## Official integration references

- [Checkout v2 and request signature](https://docs.geidea.net/docs/geidea-checkout-v2)
- [Callback signature](https://docs.geidea.net/docs/sample-callback-responses)
- [Fetch order response including isTest and capture totals](https://docs.geidea.net/docs/fetch-1)
- [KSA order endpoint](https://docs.geidea.net/reference/get-order-by-id-1)
- [KSA lookup by merchant reference](https://docs.geidea.net/reference/fetch-transaction-or-order-by-merchant-reference-1)
- [Official test cards and positive/negative scenarios](https://docs.geidea.net/docs/test-cards)
- [Railway custom configuration path](https://docs.railway.com/config-as-code)

Live activation, approved customer products/prices, refunds/disputes and a
production rollout require a separate implementation and release decision.
