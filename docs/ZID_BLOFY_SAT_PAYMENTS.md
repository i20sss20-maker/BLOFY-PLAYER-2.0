# BLOFY PLAYER renewals through BLOFY SAT (Zid)

## Goal

BLOFY PLAYER keeps device identity and entitlement data in the activation service. BLOFY SAT (Zid) owns checkout/payment. A paid Zid order is sent to the activation service and extends the matching device exactly once.

Flow:

1. Customer opens the BLOFY PLAYER web portal.
2. Customer opens `/pay` with the authenticated device context.
3. Customer selects a BLOFY PLAYER renewal product.
4. Customer completes checkout in BLOFY SAT.
5. Zid sends `order.payment_status.update` to the webhook.
6. The service verifies webhook Basic Auth, matches the paid product and device field, then extends `devices.expires_at`.
7. Replayed webhooks do not extend the device twice.

## Zid product setup

Create three non-shipping products in BLOFY SAT. Prices are controlled in Zid and are intentionally not hard-coded in the app repository.

Recommended SKUs:

- `BLOFY-PLAYER-3M` — 90 days
- `BLOFY-PLAYER-6M` — 180 days
- `BLOFY-PLAYER-1Y` — 365 days

Each product must have a required TEXT custom input field:

- Arabic label: `رقم جهاز BLOFY PLAYER`
- Suggested hint: `مثال: BLOFY-66HL-GB09 — انسخ الرقم من صفحة جهازك`
- Price: 0
- Published: true
- Required: true

Set `requires_shipping=false` for these renewal products.

## Railway configuration

Configure the activation service with:

```
BLOFY_ZID_STORE_URL=https://blofy-sat.zid.store
BLOFY_ZID_PRODUCTS_JSON=[{"planKey":"zid-3m","name":"3 أشهر","durationDays":90,"productId":"<ZID_PRODUCT_ID>","sku":"BLOFY-PLAYER-3M","productUrl":"<PRODUCT_URL>","priceLabel":"<DISPLAY_PRICE>"},{"planKey":"zid-6m","name":"6 أشهر","durationDays":180,"productId":"<ZID_PRODUCT_ID>","sku":"BLOFY-PLAYER-6M","productUrl":"<PRODUCT_URL>","priceLabel":"<DISPLAY_PRICE>"},{"planKey":"zid-1y","name":"سنة","durationDays":365,"productId":"<ZID_PRODUCT_ID>","sku":"BLOFY-PLAYER-1Y","productUrl":"<PRODUCT_URL>","priceLabel":"<DISPLAY_PRICE>"}]
ZID_WEBHOOK_USERNAME=<RANDOM_USERNAME>
ZID_WEBHOOK_PASSWORD=<LONG_RANDOM_PASSWORD>
```

## Zid webhook

Create a webhook for:

- Event: `order.payment_status.update`
- Target: `https://api.blofyplayer.com/api/v1/payments/zid/webhook`
- Username/password: exactly the same values stored in Railway

The service only activates an entitlement when the order payment status is explicitly `paid`.

## Verification endpoints

- Payment page: `https://blofyplayer.com/pay`
- Adapter health: `https://api.blofyplayer.com/api/v1/payments/zid/health`

The health endpoint reports only configuration state, never webhook credentials.

## Idempotency and safety

Every fulfilled Zid order-product pair is recorded in `zid_payment_fulfillments` with a unique constraint. A duplicate/replayed paid webhook is acknowledged but does not extend the device again.

The device ID is accepted only when it matches the BLOFY device format and exists in the activation database. Blocked devices are never reactivated by a payment webhook.

## Google Play release note

BLOFY PLAYER is a digital service. Keep the Play-distributed build consumption-only unless the app is using a Google-approved external billing/linking program for the user's region or Google Play Billing. The Zid checkout can remain available as an independent website/store purchase flow; do not add or enable in-app purchase steering for the Play build without confirming the applicable Play program requirements.
