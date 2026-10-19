# BLOFYSAT / BLOFY PLAYER: Geidea preparation (NOT LIVE)

As of 2026-10-19, the merchant reports Geidea has accepted their Payment Gateway application and will email API credentials in the coming days. Acceptance is **not** confirmation that the live credentials are available or payment acceptance has been successfully tested.

## Safe preparation completed
- Existing BLOFY activation backend already contains subscription/device renewal logic and separate Tap and Zid payment integrations. Preserve them.
- Added src/geidea-preflight.mjs: a standalone, server-only helper for KSA Hosted Payment Page (HPP) v2 Create Session payloads.
- Prices are taken only from a server-controlled plan allowlist; amount is formatted with two decimal places in SAR.
- The Create Session signature is HMAC-SHA256 over merchantPublicKey + amount + currency + merchantReferenceId + timestamp, Base64 encoded, keyed with API password.
- KSA session URL: https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session
- KSA Checkout script: https://www.ksamerchant.geidea.net/hpp/geideaCheckout.min.js
- The module **does not** call Geidea, create orders, expose an API route, validate callbacks, or activate subscriptions. It is NOT imported by the running server. Running it cannot collect payments.

## After API credentials arrive (not yet implemented)
1. Confirm the actual website/checkout ownership and whether customers buy BLOFY PLAYER device activations or BLOFYSAT/Xtream service accounts, or both.
2. Confirm actual merchant-approved plans and prices. Earlier draft prices are not final merchant approval.
3. Store Geidea merchant public key and API password in server secret settings ONLY. Never add keys to Git, screenshots, browser code, chat messages, or public logs.
4. Add database pending orders with unique, unguessable references, expected price/currency, customer and entitlement target. Never accept price/duration from the browser.
5. Add an authenticated backend endpoint to create an HPP session using KSA Basic Auth. Return only safe session information to the browser.
6. Launch the official Geidea hosted checkout. Do not handle card data in BLOFY code.
7. Add an HTTPS server webhook. Validate the authentic Geidea signature and (as necessary) independently fetch order status; match exact amount, currency, merchant, reference, and verified PAID status. Browser callbacks are NOT proof of payment.
8. Activate a license/account at most once inside a DB transaction, using the existing subscriber ledger. Include replay/idempotency protection.
9. Handle refunds/cancellations/reconciliation and run staging tests before enabling live payment.
10. Do not change current public payment provider or publish checkout until approved and tested.

## Server-only settings to configure LATER
BLOFY_GEIDEA_ENABLED=false
GEIDEA_MERCHANT_PUBLIC_KEY=<set-in-secret-manager>
GEIDEA_API_PASSWORD=<set-in-secret-manager>
BLOFY_GEIDEA_PLANS_JSON=<merchant-approved-json>

Keep disabled until the full callback-verification and fulfillment implementation is reviewed.

## Test
From services/activation run:

    node --test test/geidea-preflight.test.mjs

## Official Geidea documentation
- https://docs.geidea.net/docs/geidea-checkout-v2
- https://docs.geidea.net/docs/sample-callback-responses
