# Shop architecture

## Why no relational database

This is a static HTML/CSS/JS site on Vercel with no framework and no
existing database. Stripe is the system of record for payments (Dashboard
shows every session, line item, email, shipping address) — adding a full
Postgres schema just to duplicate that would be scope creep. Redis (via a
Vercel Marketplace integration, e.g. Upstash) fills exactly three narrow
gaps Stripe doesn't cover: idempotency, a denormalized order log for
reporting, and inventory counters for `self`-fulfilled items. Nothing else
lives there — catalog/provider mapping stays in Stripe Product metadata
(§1 of the original spec), read at webhook time.

## Where order state actually lives

| What | Where |
|---|---|
| Payment, line items, customer/shipping details | Stripe Dashboard (source of truth) |
| Product ↔ fulfillment provider/variant mapping | Stripe Product metadata (`fulfillment_provider`, `provider_variant_id`) |
| Public product catalog (what `shop.html` renders) | Redis `product:{internalProductId}` + `products:index` (`lib/product-catalog.js`), served via `api/products.js` |
| Apliiq production/shipping status | Apliiq's own dashboard, plus `tracking`/`providerStatus` on the Redis order record once `api/apliiq/fulfillment.js` receives a callback |
| Denormalized order record for reporting | Redis `order:{stripeSessionId}` (`lib/order-log.js`) |
| Revenue/units/provider breakdown | `api/admin/orders-report.js` (reads the Redis order log) |
| Consented marketing contacts | Redis `contacts:index` (`api/admin/contacts-export.js`) |
| `self`-fulfilled stock counts | Redis `inventory:{sku}` (`lib/inventory.js`) |

## The provider abstraction

`lib/fulfillment/`:

- `types.js` — JSDoc typedefs only (plain JS, not TypeScript, matching the
  rest of the repo).
- `registry.js` — a `Map` of provider name → implementation, with
  `getFulfillmentProvider(name)` throwing clearly if a provider isn't
  registered or isn't configured (missing env vars) rather than silently
  no-oping.
- `grouping.js` — `groupItemsByProvider(items)` splits a checkout's line
  items by provider so each provider gets exactly one order submission,
  never mixed.
- `{self,apliiq,printful}-provider.js` — one file per provider, same shape:
  `name`, `isConfigured()`, `createOrder(request)`, `getOrder(id)`,
  `normalizeStatus(raw)`.
- `index.js` — registers every implemented provider; requiring
  `lib/fulfillment` (not `lib/fulfillment/registry` directly) once at the
  top of anything that calls `getFulfillmentProvider` guarantees
  registration already happened.

Adding a fourth provider is additive — see `docs/provider-migration.md`.

## Idempotency: the fail-closed / fail-loud split

`lib/idempotency.js` deliberately has two asymmetric code paths, not
one generic try/catch:

- **`claimEvent`** (before any provider submission) — an atomic Redis
  `SET NX EX` keyed on the **Stripe event ID**. If the Redis call itself
  throws (network/timeout/outage), the caller (`api/stripe-webhook.js`)
  **fails closed**: returns a non-2xx status so Stripe retries later,
  rather than risking a duplicate physical order by proceeding without
  knowing whether this is really the first attempt. Stripe's retry window
  (up to ~3 days) gives Redis plenty of time to recover.
- **`completeEvent`** (after a successful provider submission) — this
  **never throws**. By this point the real-world order has already gone
  out; a Redis write failure here must not cause a Stripe retry (which
  could double-submit if the "in_progress" claim has since expired).
  Instead it logs clearly and returns `false` so the caller can send a
  human alert (`lib/alert.js`) to verify Redis state manually.

## Per-provider failure isolation

A mixed order (e.g. one Apliiq item + one self-fulfilled item) submits each
provider group independently (`api/stripe-webhook.js`'s `submitProviderGroup`).
One group failing:

- Never blocks or retries another group.
- Never marks the whole order failed.
- Logs a greppable line and sends an alert email to
  `ORDER_NOTIFICATION_EMAIL` — regardless of which provider failed, not
  just `self`.
- Never re-submits a group that already succeeded, since re-submission
  isn't gated by re-checking the provider, only by the idempotency claim
  already having been taken for this Stripe event.

## Product catalog and variant flattening

`shop.html` fetches `GET /api/products` instead of hardcoding a `PRODUCTS`
array. `lib/product-catalog.js`'s `flattenProductToCards` turns each
catalog record's `variants[]` into **one storefront card per variant** —
e.g. a tee with 3 colors × 4 sizes renders as 12 cards. This is a
deliberate choice, not an oversight: the storefront has no size/color
picker UI, and building one is explicitly out of scope for this pass. If
that stops being acceptable (too many near-duplicate cards once Apliiq
pushes larger size/color grids via Add to Store), the fix is a picker
component in `shop.html` plus a change to `flattenProductToCards` — the
catalog data itself doesn't need to change shape.

## Known v1 limitations

- **Inventory tracking** (`lib/inventory.js`) is a simple counter
  (`DECRBY`), not a reservation/holds system. A decrement that would go
  negative still succeeds (the customer already paid) and fires an
  oversold alert instead of blocking — there's no cart-time stock check.
- **Redis env var names aren't hardcoded.** `lib/redis.js` checks a
  few candidate names (`KV_REST_API_URL`/`UPSTASH_REDIS_REST_URL`/etc.)
  since the real names depend on which Marketplace integration gets
  installed — confirm them in the Vercel project's environment variables
  after installing.
- **Recipient addresses only store a 2-letter state/country code**, not
  full names — see docs/apliiq-setup.md for where that's an approximation
  in the Apliiq payload mapping.
- **Product Search and Add to Store have no documented authentication** —
  see docs/apliiq-webhooks.md. The compensating control is that Add to
  Store can only ever create inactive draft catalog entries, never a live,
  purchasable product.
- **Which secret signs the inbound Fulfillment/Warehouse Shipment Complete
  HMAC is an assumption** (reusing `APLIIQ_SHARED_SECRET`), not a confirmed
  fact — see docs/apliiq-webhooks.md.
- **`findOrderByProviderOrderId` is a linear scan** over `orders:index`
  (`lib/order-log.js`) rather than a dedicated reverse-lookup key — fine at
  storefront volumes, not at scale.
