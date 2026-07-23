# Testing the shop

## Unit tests (no external services needed)

```bash
node --test
```

Covers `groupItemsByProvider`, the idempotency claim/complete paths
(mocked Redis client — first claim succeeds, a second claim on the same
event no-ops, a simulated Redis error on claim fails closed, a simulated
error on the completion write doesn't throw), inventory decrement/oversold
paths (mocked Redis client), and the Apliiq auth signer + order payload
mapping (fixtures, no live calls). No test in this suite ever places a
live Apliiq order or calls a real API — see the Apliiq section below for
why that matters.

## Product activation check

```bash
node scripts/validate-products.js          # skips live Stripe price checks
STRIPE_SECRET_KEY=sk_test_... node scripts/validate-products.js   # full check
```

Reads `PRODUCTS` out of `shop.html`, prints every activation problem it
finds (missing/placeholder `priceId` or `providerVariantId`, an
unconfigured or unsupported `fulfillmentProvider`, a missing product
image) rather than stopping at the first. Draft products (`active: false`)
report as informational, not blocking — only `active: true` products fail
the check.

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
