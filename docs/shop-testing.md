# Testing the shop

## Unit tests (no external services needed)

```bash
node --test
```

Covers `groupItemsByProvider`, the idempotency claim/complete paths
(mocked Redis client — first claim succeeds, a second claim on the same
event no-ops, a simulated Redis error on claim fails closed, a simulated
error on the completion write doesn't throw), inventory decrement/oversold
paths (mocked Redis client), the Apliiq auth signer + order payload
mapping (fixtures, no live calls), the inbound `x-apliiq-hmac` verification
(`tests/apliiq-hmac.test.js` — valid/tampered/wrong-secret/missing-header,
against a fixed payload+secret so the expected hash is a known value),
Product Search's catalog filtering (`tests/product-search.test.js`), and
Add to Store's Redis-only writes plus its validation-error path
(`tests/add-product.test.js`, mocked catalog upsert — Add to Store never
calls Stripe), `scripts/activate-product.js`'s flat-price Stripe
Product/Price creation and re-run idempotency
(`tests/activate-product.test.js`, mocked Stripe and catalog), and
`api/create-checkout-session.js`'s weight-tiered shipping logic —
standard vs. upgraded vs. free-shipping-overrides-both, plus a missing/
absent stored weight falling back to 0oz instead of throwing
(`tests/create-checkout-session.test.js`, mocked Stripe + variant index;
`tests/products.test.js` separately covers `buildVariantIndexByStripePriceId`
itself against a fake Redis client), and the presale campaign logic —
`lib/presale.js`'s `computePresaleStatus` (claimed-count math, closing via
unit cap vs. closing via deadline, tested independently as pure functions
in `tests/presale.test.js`), `api/products.js`'s `attachPresaleStatus`
(`tests/products.test.js`), and `api/create-checkout-session.js` rejecting
a closed presale SKU server-side even when the Stripe Price itself is
still perfectly valid (`tests/create-checkout-session.test.js`) — including
the pooled-inventory case, where two different size variants (e.g. L and
XXL) share one `inventoryKey` and both get checked against the identical
shared remaining count (`tests/products.test.js`,
`tests/create-checkout-session.test.js`,
`tests/presale.test.js`). `tests/stripe-webhook.test.js` covers
`buildFulfillmentItems` resolving `inventoryKey`/`groupId`/`size` off
Stripe Product metadata, plus a direct proof — using the real
`decrementInventory`, not a mock — that an L order and an XXL order
decrement the exact same shared counter rather than two independent ones.
`tests/activate-product.test.js` also covers `metadata.inventory_key` only
getting set when a variant declares one. `tests/create-blu2-presale-tee.test.js`
covers that script's variant-building/migration logic (5 pooled size
variants; a stale single-SKU variant from the product's original,
incorrect build is dropped rather than carried forward). `tests/presale-tally.test.js`
covers the print-shop tally report's per-size summing. No test in
this suite ever places a live Apliiq order or calls a real API — see the
Apliiq section below for why that matters.

## Verifying self-fulfilled inventory + the oversold alert, for real

```bash
node scripts/verify-self-inventory.js
```

One-off manual script, deliberately **not** picked up by `node --test` —
named `verify-` rather than `test-` because a literal `test-*.js` name
matches the test runner's default file discovery and gets auto-executed
as a real test (confirmed the hard way while building this). Creates a
throwaway `self`-fulfilled catalog entry + inventory count (starting
stock 2) under a clearly-marked test product ID/SKU, calls the exact same
`decrementInventory(item.sku, item.quantity)` api/stripe-webhook.js calls
per unit purchased — three times, so the third pushes stock negative and
triggers a real oversold alert email to `ORDER_NOTIFICATION_EMAIL` — then
deletes both the catalog entry and inventory key in a `finally` block.
Needs real Redis credentials and `RESEND_API_KEY`/`ORDER_NOTIFICATION_EMAIL`
set to see the actual alert email; safe to run against production Redis
either way, since cleanup always runs.

## Activating an Apliiq product

```bash
node scripts/activate-product.js apliiq-5989067 --activate --price=45.00
```

Creates a real Stripe Product + Price for every variant on that catalog
entry that doesn't already have one, at a single flat `--price` for the
whole product (no per-variant pricing), then sets the entry `active:
true`. `--price` is only required the first time — once every variant
already has a `stripeProductId`, re-running with just `--activate`
recreates nothing (useful if Apliiq later appends a new size/color: only
the new SKU gets Stripe objects). Needs `STRIPE_SECRET_KEY` and real Redis
credentials set.

## Launching the BLU2 presale tee (`self`-fulfilled, Royal Tees Printing)

```bash
node scripts/set-inventory.js RT-BLU2-PRESALE 50     # only if you're re-seeding stock by hand
PRESALE_PRICE_CENTS=4000 node scripts/create-blu2-presale-tee.js
```

`scripts/create-blu2-presale-tee.js` is the `self`-provider equivalent of
Apliiq's Add to Store webhook — it writes the draft catalog entry (5 size
variants, `RT-BLU2-PRESALE-S`/`-M`/`-L`/`-XL`/`-XXL`, each pointing its
`inventoryKey` back at the one shared `RT-BLU2-PRESALE` counter — the
50-unit hard cap is one pool across all sizes, not 50-per-size), seeds
that shared counter to `PRESALE_CAP_UNITS` (default 50, only if unset —
never clobbers an in-progress sell-through), then calls
`scripts/activate-product.js`'s `activateProduct()` to create 5 real
Stripe Product/Prices (one per size, same flat `PRESALE_PRICE_CENTS`) and
flip the entry `active: true`. Safe to re-run.

Also confirm `PRESALE_SHIP_ESTIMATE_COPY` (defaults to "Ships in 4-6
weeks", `api/shop-config.js`) against Royal Tees' real quoted turnaround
before launch.

The presale closes — permanently, not a revert to retail — the moment
either `PRESALE_CAP_UNITS` is hit or `presaleEndsAt` passes, whichever is
first. This is enforced in `api/create-checkout-session.js`, not just
hidden in `shop.html`: a closed presale's Stripe Price is still perfectly
valid and purchasable as far as Stripe is concerned, so the closing check
has to happen in application code on every checkout attempt, not once at
"deactivation" time. See `lib/presale.js`'s `computePresaleStatus` for the
shared closing logic used by both `api/products.js` (display) and
`api/create-checkout-session.js` (enforcement).

## Product activation check

```bash
node scripts/validate-products.js          # skips live Stripe price checks
STRIPE_SECRET_KEY=sk_test_... node scripts/validate-products.js   # full check
```

Reads the Redis product catalog (`lib/product-catalog.js`), flattens each
product's variants the same way `api/products.js` does, and prints every
activation problem it finds (missing/placeholder `priceId` or
`providerVariantId`, an unconfigured or unsupported `fulfillmentProvider`,
a missing product image) rather than stopping at the first. Draft entries
(`active: false`) report as informational, not blocking — only
`active: true` entries fail the check. Needs real Redis credentials set
(see `docs/shop-architecture.md`); against an empty catalog it just reports
nothing to validate yet.

## Running the shop locally

```bash
vercel dev
```

Needs at minimum, in `.env.local` (never commit this):

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...      # from `stripe listen`, see below
RESEND_API_KEY=re_...
ORDER_NOTIFICATION_EMAIL=you@example.com
SITE_URL=http://localhost:3000
STORE_NAME=BLU2
ORDER_REF_PREFIX=BLU2
```

Plus a Redis integration's real env vars once one's installed (see
`docs/shop-architecture.md`) — without them, `api/stripe-webhook.js`
correctly fails closed (503) rather than silently skipping the idempotency
claim, so you'll notice immediately if they're missing.

Open `/shop.html`, add a `self`-fulfilled item to the cart, and complete a
Stripe test-mode Checkout end to end — confirm the redirect back to
`?checkout=success` and that the notification email actually arrives.

## Stripe webhook — local loop

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
Complete a test checkout and confirm in the logs that:

- The order log gets written (`order:{sessionId}` in Redis).
- The `self` group (if present) sends the notification email and
  decrements inventory exactly once.
- Re-sending the same event (`stripe events resend <event_id>`, or
  `stripe trigger checkout.session.completed` twice against the same
  fixture) does **not** double-email or double-decrement — that's the
  idempotency claim doing its job.

## Apliiq — real orders, not a sandbox

Apliiq may not have a full sandbox environment, so a "test order" is a
real order. Per `docs/apliiq-setup.md`:

- Use one clearly-labeled, lowest-cost test product.
- Ship to an address you control.
- Know how to cancel it in the Apliiq dashboard before it enters production.
- Never let this happen from the automated test suite — that's exactly why
  `ALLOW_LIVE_APLIIQ_TEST_ORDERS` exists and must stay `false` in
  production. If you ever write a manual script that places a real test
  order, gate it behind that flag explicitly.
