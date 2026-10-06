# BLOFY SAT activation integration

## Current preparation

Store: `3202741`. The following products were created hidden, with unlimited inventory,
quantity limit one, shipping disabled, and a required text personalization field:
`رقم جهاز BLOFY PLAYER (Device ID)`.

| Plan | SKU | Zid product ID | License duration |
| --- | --- | --- | --- |
| 3 months | BLOFY-PLAYER-3M | 9d53456e-ea98-40b0-957d-468267c7eefd | 90 days |
| 6 months | BLOFY-PLAYER-6M | 389b060a-d3d9-4fce-bb42-db4bfe3460e6 | 180 days |
| 12 months | BLOFY-PLAYER-12M | a1314822-0c64-42ad-90a3-4aa419c7db48 | 365 days |

Prices and public purchase URLs still require merchant approval/verification. At preparation,
the hidden drafts have prices 0 / 20 / 0 SAR respectively. Existing Tap configuration has
10 / 20 / 25 SAR for these durations; these are proposals, not approved Zid prices.
Do not enable or publish a zero-price activation product.

## Runtime configuration

Deploy the reviewed code to `blofy-activation-portal` in Railway project
`60e7758a-6b19-4445-b21c-9cb928ccef04`, environment
`7a3e9208-69a8-45f9-b5e7-427921de73a9`, service
`73f961be-ef0f-444a-844e-a8a5df5ef66c`.

Keep the provider as Tap and `BLOFY_ZID_ENABLED=false` until the end-to-end acceptance
check succeeds. Enabling the webhook while retaining Tap allows verification before
changing the public payment page.

Configure server-side only:

- `BLOFY_ZID_STORE_ID=3202741`.
- `BLOFY_ZID_AUTHORIZATION`: Zid app Authorization header value.
- `BLOFY_ZID_MANAGER_TOKEN`: authorized manager token. This is a separate credential;
  a manager token alone does not provide the app Authorization header.
- `BLOFY_ZID_WEBHOOK_SECRET`: at least 32 random characters, also used as the Basic
  authentication password when registering the webhook. Username: `blofy-zid`.
- `BLOFY_ZID_PLANS_JSON`: array containing `planKey`, `productId`, `sku`, `name`,
  `durationDays`, approved positive `priceMinor` in halalas, and verified `productUrl`.
  Use `zid-3m`, `zid-6m`, `zid-12m` for plan keys and the IDs/durations above.
  Only HTTPS product paths on `blofysat.com`, `www.blofysat.com` or
  `blofy-sat.zid.store` are accepted; verify the store's actual public host before use.
- `BLOFY_ZID_ENABLED=true` only after all credentials/plans are populated.
- `BLOFY_PAYMENT_PROVIDER=zid` only when all product URLs work and testing passes.

Creating app/manager credentials requires the merchant's confirmation. Request only
the order-reading and webhook-management permissions required by Zid's endpoints
(`orders.read`, `third_webhook_write`); check exact scope identifiers in the app UI.
Do not upgrade the merchant's subscription or accept new terms without authorization.

Register the HTTPS endpoint
`https://api.blofyplayer.com/api/v1/payments/zid/webhook` for `order.create`,
`order.status.update`, and `order.payment_status.update`, using the Basic credentials
above. A public endpoint without authentication must not be used.

## Payment and activation behavior

The payment page verifies existing device credentials before returning a store product
URL. It asks the customer to copy Device ID into the required product field. Device PIN
is never included in the Zid URL or webhook registration.

Webhook JSON supplies only an order ID. The service obtains current order details from
Zid's fixed API endpoint and verifies order/store ID, paid state, currency, exact
allowlisted product ID plus SKU, quantity one, required Device ID and positive amount.
Unpaid, cancelled, fraud-marked, unknown/blocked/deleted-device and zero-price purchases
cannot create new entitlements. Other store products are ignored.

A transaction, database locks and a unique grant identity ensure duplicate concurrent
notifications grant once. Renewal preserves remaining active/trial time; expired
licenses start now. Lifetime licenses stay unlimited. Changed replay data is rejected.
Refunds/cancellations after activation are flagged in `zid_license_grants.needs_review`
and `device_audit`; they require manual review and do not automatically revoke a device
that may have subsequent paid renewals. Merchant support must monitor these records.
Existing Tap subscriptions remain visible through the shared subscription status API.

## Acceptance checks before public launch

1. Approve and save nonzero prices, then verify each product's required Device ID field
   and no-shipping behavior on its actual public product page.
2. Create credentials and register authenticated webhooks; verify no secrets appear in
   URLs, repository content or logs.
3. Use a designated merchant-approved test device/order. Confirm a pending order does
   not activate it. The merchant completes any real payment themselves.
4. After successful payment, verify the returned order API shows the exact product and
   Device ID, one grant/audit entry exists, expiry increased by the selected duration,
   and the application reports active.
5. Replay the notification and confirm expiry does not increase again. Purchase a
   second approved renewal only if needed and verify remaining time is preserved.
6. Select Zid as public provider and verify the complete QR → payment page → store
   checkout → paid webhook → application activation flow.

Rollback: change `BLOFY_PAYMENT_PROVIDER=tap` and `BLOFY_ZID_ENABLED=false`.
Keep grant records; deleting them would defeat duplicate-payment protection.

## Verification commands

`npm run check` and `npm test` cover syntax and behavioral unit checks. The dedicated
GitHub Actions workflow runs an actual HTTP server and a disposable PostgreSQL database
using `node --test test/zid-payments.test.mjs test/zid-payments.runtime.mjs`.
Database tests require `BLOFY_TEST_DATABASE_URL` pointing exclusively to local
`blofy_zid_test`; they never connect to production or call the real Zid API.

Primary API references: https://docs.zid.sa/ (View Order, Create Webhook, Webhook Events).
Automated fixtures do not substitute for the live merchant-order acceptance check.
