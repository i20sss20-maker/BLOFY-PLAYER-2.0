# BLOFY STORE PRO — mobile performance and safe checkout readiness

## Change summary (isolated feature branch)

The public BLOFY storefront no longer downloads the external Geidea
`geideaCheckout.min.js` at page load. Browsing products, search, FAQ or
distributor pages does **not** need a payment SDK.

For the existing on-page Geidea checkout button, a bounded SDK loader
resolves before creating the server-side checkout session. The familiar
`GeideaCheckout` callbacks, session validation, saved order access token,
status polling, coupon price validation and fulfillment flow are unchanged.
If a script download fails, no checkout POST is sent and the visitor can
retry later.

The main `/store/cart` flow is intentionally unchanged. This is a
network-loading optimization, **not a verified Apple Pay repair**.

## Automated performance audit

Workflow: `.github/workflows/blofy-store-pro-mobile-browser.yml`.

Actual Chromium browser engine in Ubuntu 24.04 GitHub Actions; device
**emulation** (360px / 390px touch-screen mobile, 768px tablet), not
physical Android Chrome or iPhone Safari hardware.

Scenarios:
- Store homepage at 360 / 390 / 768 CSS pixels.
- Cart, AI shopping assistant, and independent reseller login at 390px.
- Screenshots attached to the workflow run along with JSON metrics.

Measures: first-contentful paint, observed LCP, layout shift (CLS),
horizontal overflow, first-party bytes and number of requests.

Gates are intentionally generous in CI; production targets still need
real-device testing on typical Saudi network speeds, especially an
Android 9 box / entry-level Android mobile and iOS Safari:

- zero horizontal overflow at each tested width;
- <= 1.1 MB initial first-party resources in the isolated fixture;
- first paint <= 6000 ms on runner hardware;
- CLS <= 0.25;
- no accidental checkout calls or Geidea SDK before a payment click.

**Important limitations:** The browser fixture serves the checked-in
public HTML and assets, and responds to public API calls with safe mock
data. It blocks all external network requests and Geidea checkout actions.
Passing does not prove real CDN latency, payment readiness, Apple Pay success,
webhook delivery, inventory readiness or physical-device performance.

## Real mobile release checklist

1. On production-equivalent staging, log 20 cold-load repetitions with Chrome
   DevTools under mobile Fast 4G and low-end CPU throttling.
2. Repeat on an actual entry-level Android mobile with Chrome and actual
   iPhone Safari, capture LCP, INP and CLS. Validate usability at 320px.
3. Ensure home search, horizontal categories, bottom Orders and cart count
   behave correctly; tab/navigate back without unwanted reloads.
4. Confirm the browser does not fetch Geidea SDK until an *explicit*
   payment action, and the vendor script executes under production CSP.
5. Verify Visa/Mada/Mastercard completed payments and **only** verified
   server-side paid statuses issue codes. Any Apple Pay payment must be
   separately confirmed end-to-end after Geidea's latest provisioning
   changes, with no duplicate charge attempt.
6. Release on the Railway source branch only after CI, staging and
   supervised checkout verification; rollback is the previous tested
   Railway commit. Do not change payment, code delivery or public stock
   while performing page-speed tests.
