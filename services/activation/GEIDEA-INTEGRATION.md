# BLOFYSAT / BLOFY PLAYER: Geidea sandbox integration (NOT LIVE)

## Merchant status — 2026-10-22
Geidea has emailed **test-only** Payment Gateway (PGW) MID credentials. The merchant reports production credentials will be issued after successful Visa, Mastercard and Mada test transactions and confirmation to Geidea. Do not assume the test keys permit real transactions.

The credentials must be stored **only** in private server-side environment variables (and rotated before production if exposed). Never commit them, show them in screenshots, send them through public web pages, or reuse them as production credentials.

## Implemented in this isolated PR
- Existing BLOFY activation backend has device subscriptions, renewal logic, Tap and Zid flows; all remain unchanged.
- `src/geidea-preflight.mjs`: allowlisted SAR plan validation, two-decimal formatting and server-side HMAC SHA-256/Base64 request signature.
- `src/geidea-sandbox-client.mjs`: explicit opt-in POST to the official KSA Checkout v2 Create Session endpoint using server-only Basic authentication. Checks response code, session ID, currency, amount and merchant reference. Errors deliberately omit provider payloads.
- `src/geidea-sandbox-cli.mjs`: a manual, **local-only** sandbox session creation tool. Prints a Geidea-hosted checkout URL, never secrets or card data.
- `test/geidea-preflight.test.mjs` and `test/geidea-sandbox-client.test.mjs`: offline unit tests with mocked Geidea responses; tests do NOT contact production services.
- None of the above are imported by production server; no changes to customer payment flow or device activation. The CLI **does not** verify payment completion.

## Running the local, manual sandbox session test
Run from `services/activation` on a trusted machine or private test server with network access to Geidea's API.

Configure the following environment variables **outside the repository**:

```text
BLOFY_GEIDEA_TEST_MODE=enabled
GEIDEA_TEST_MERCHANT_PUBLIC_KEY=<Geidea email TEST public key>
GEIDEA_TEST_API_PASSWORD=<Geidea email TEST API password>
GEIDEA_TEST_PRICE_MINOR=100
GEIDEA_TEST_CALLBACK_URL=https://<your-controlled-https-host>/test/geidea/callback
GEIDEA_TEST_RETURN_URL=https://<your-controlled-https-host>/test/payment-result
```

The example price is **SAR 1.00 in the sandbox only**, not an approved public subscription price. A proper HTTPS callback handler must be implemented and running to validate the final payment outcome; do not treat URL redirects or CLI success as proof of completed payment.

```sh
node --test test/geidea-preflight.test.mjs test/geidea-sandbox-client.test.mjs
node src/geidea-sandbox-cli.mjs
```

The CLI prints a checkout link only if Geidea acknowledges an initiated checkout session with matching details. The link may be used with **official sandbox cards only**. Save response codes, selected card network, test order ID, timestamp, provider order status and webhook evidence for the merchant to submit to Geidea.

**Important:** This execution environment cannot currently reach Geidea over the network, so no provider-hosted request has been executed or certified by us.

## Remaining stages before any production release
1. Confirm whether the paid entitlement is BLOFY PLAYER device activation, BLOFYSAT/Xtream subscription or both. Set merchant-approved live plans and prices separately.
2. Implement persistent pending orders with unique merchant references and idempotency.
3. Implement checkout API route on a protected staging host; build customer UI that exposes only the session ID. Never expose API password to clients.
4. Implement SSL-protected webhook receiver verifying the Geidea callback signature, exact merchant ID/reference, amount/currency, final successful response and order status; reconcile with the provider. Never activate on a browser-only return URL.
5. After verification, activate exactly one subscription in an atomic transaction; implement refund and dispute handling.
6. Perform Visa, Mastercard, Mada success/failure and cancellation tests on merchant test account.
7. Obtain production credentials from Geidea, securely configure live host, re-test in controlled rollout and then separately approve publication.

## Official Geidea references
- Checkout v2: https://docs.geidea.net/docs/geidea-checkout-v2
- Test cards: https://docs.geidea.net/docs/test-cards
- Callback signature: https://docs.geidea.net/docs/sample-callback-responses
