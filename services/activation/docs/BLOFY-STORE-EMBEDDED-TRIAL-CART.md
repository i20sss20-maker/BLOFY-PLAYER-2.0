# BLOFY STORE — Zero SAR free-trial cart and embedded Geidea payment

## New product ordering
BLOFY STREAM and Xtream product selectors now have a **free one-day / 0 SAR**
option beside paid 3-month, 6-month and annual durations. A visible third
offer card offers distinct STREAM and Xtream trial Add-to-Cart buttons.

- Trial SKU `trial-stream-1d` or `trial-xtream-1d`.
- Quantity one, max one trial channel per basket. Only one trial ever
  per email-verified customer account, enforced in PostgreSQL across both.
- The page pulls real trial stock from `GET /api/v1/store/trials/availability`.
  If stock is disabled/out of stock, the free buttons route to `/store/trial`
  to explain availability, rather than advertising a guaranteed code.
- Customer can add free trial to the **same** /store/cart list and receive
  a price of **0 SAR**. No card details or Geidea session are needed.
- Save basket to customer account through a separate `parseSavedStoreCart`
  that permits only specifically allowlisted trial SKUs.
- Paid quotes and actual Geidea checkouts still use the original
  `parseStoreCart` which *rejects* both trial SKUs.
- Free-only basket: confirmed email → `POST /api/v1/store/trials/claim`
  → show generated stock voucher, no order created at Geidea.
- Mixed basket: claim the free trial **first**, then keep the paid item
  in the customer's cart for a **separate explicit payment click**.
  This avoids claiming that a 0 SAR code is part of a paid Geidea transaction.
- Codes are not placed in browser persistent storage. Code recovery remains
  through `/store/trial` with same verified account.
- Trial clock is one day after first successful redeem, not cart creation.

## Embedded checkout for PAID items only

Geidea's official Drop-in API:
`const payment=new GeideaCheckout(onSuccess,onError,onCancel)`;
`payment.startPayment(sessionId,null,'checkout-tag')`.

BLOFY owns the **surrounding** page, order summary, purple color palette
and mobile layout. Geidea owns the hosted iframe and all card fields.
Do not imitate or embed card inputs directly in BLOFY.

The KSA SDK `https://www.ksamerchant.geidea.net/hpp/geideaCheckout.min.js`
is loaded **only on the payment click**, not during browsing and not for
zero-value trial claims. The backend still creates exactly the same
Geidea signed session, callback, customer order, and secure receipt token.

If the iframe or SDK fails, the UI shows the **same pending session**
at the official hosted Geidea URL as a fallback. It never silently creates
a second payment session. SDK success is *not* proof of paid/fulfilled:
BLOFY checks the existing server-side order settlement status first.

CSP: the cart page allows Geidea KSA scripts, connections and frame
origins while leaving account/order pages with the old stricter CSP.

Docs:
https://docs.geidea.net/docs/geidea-checkout-v2

## Rollout and test gate

- Automated tests: `node --test test/store-zero-trial-dropin.test.mjs
  test/store-cart-geidea-redirect.test.mjs test/store-cart-payment.test.mjs
  test/store-trial-inventory.test.mjs`.
- Check Safari and Android Chrome sizes, including 3DS challenges in the
  vendor's hosted iframe. Some 3DS/browser settings may require the
  official same-session hosted fallback.
- Test **one real supervised** Mada/Visa checkout, verify the webhook and
  only one paid order, and verify both trial channels' first activation and
  24-hour expiry.
- Trial code issuance remains off by default until owner seeds trial stock
  from the existing owner inventory panel and checks device activation:
  `BLOFY_STORE_TRIALS_ENABLED=true` after explicit readiness.
- Old paid checkout Geidea order handlers, quotas, coupons, prices, cart
  voucher fulfillment, order status and callbacks remain unchanged.
- Disable trial issuance without touching paid checkout by setting the
  flag `BLOFY_STORE_TRIALS_ENABLED=false`. Rollback Geidea UI by restoring
  prior `store-cart.html`, `store-cart.js`, `store-checkout-theme.css`
  and cart CSP on the previous production commit.
