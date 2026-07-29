# Stripe setup

## Products & Prices

Create one Stripe Product + Price per sellable variant (e.g. "BLU2 Tee —
Black — M" is its own Product, not a size dropdown inside one Product).
For Apliiq-sourced products this happens in `scripts/activate-product.js`
at a single flat price for the whole product, not in
`api/apliiq/add-product.js` — Add to Store only ever writes the draft
catalog entry (see `docs/apliiq-webhooks.md`). On each Product, set
metadata:

- `fulfillment_provider` — `"apliiq"` | `"printful"` | `"self"`
- `provider_variant_id` — required for `apliiq`/`printful` (the provider's
  own SKU/variant ID); omit for `self`

`api/stripe-webhook.js` reads this metadata at webhook time via
`expand: ['line_items.data.price.product']` — it's the only place
fulfillment routing decisions get made, so it must be correct before a
product goes `active: true` in `shop.html`. Run
`node scripts/validate-products.js` before flipping that flag.

## Checkout Session config (`api/create-checkout-session.js`)

Already wired: server-side price lookups (never trusts a client-sent
price), `shipping_address_collection: { allowed_countries: ['US'] }`,
`billing_address_collection: 'required'` (this is how name gets collected —
Checkout has no bare name-only field), `phone_number_collection: { enabled: true }`.

### Shipping: weight-tiered, not a flat per-item surcharge

Before creating the Session, `handleCreateCheckoutSession` sums every cart
line's real stored `weight` (oz) via
`buildVariantIndexByStripePriceId` (`lib/product-catalog.js`) — the actual
value Apliiq sent in its Add to Store payload, not an estimate. A line
whose variant has no stored weight (hand-edited catalog entry, or a
variant deactivated after being added to a cart) contributes 0oz and logs
a warning, rather than failing checkout.

- Under 16oz total → `SHOP_APLIIQ_FLAT_SHIPPING_CENTS` ("Standard shipping").
- 16oz or more → `SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS` ("Upgraded
  shipping") — this mirrors Apliiq's own published threshold requiring
  their Upgraded Shipping service at that weight. Absent the env var, this
  defaults to 2x the flat rate as a placeholder; neither that default nor
  the flat rate itself is a confirmed real cost yet — confirm both with
  Apliiq (or from a real order invoice) before launch.
- `SHOP_FREE_SHIPPING_THRESHOLD_CENTS` (by subtotal) overrides either tier
  to $0 ("Free shipping") regardless of weight.

`SHOP_APLIIQ_ADDITIONAL_ITEM_CENTS` (a flat per-extra-item surcharge) was
removed — the weight tiers already capture "more items costs more to
ship" more accurately than a fixed per-item add-on did, so keeping both
would have been redundant, dead-if-unset config.

### The marketing-consent checkbox isn't literally a checkbox

Verified against Stripe's current API reference while building this:
`custom_fields[].type` only accepts `text`/`numeric`/`dropdown` (no
checkbox), and `consent_collection.promotions` — Stripe's built-in
promotional-consent checkbox — can't carry custom copy (Stripe generates
the label) and doesn't document a guaranteed unchecked-by-default state.
Neither fits "unchecked by default, with the full email+SMS legal
disclosure text."

What's actually implemented: a required `custom_fields` **dropdown**
(`marketing_consent`, options "No thanks" / "Yes, sign me up",
`default_value: 'no'` — the dropdown API *does* document default-value
behavior) plus the full disclosure text in `custom_text.submit.message`,
shown right above the pay button. `api/stripe-webhook.js` reads the
selection back from `session.custom_fields`. Functionally equivalent to a
checkbox; worth knowing if you're looking at the Checkout page and
expecting an actual `<input type="checkbox">`.

### Stripe Link

Enable Link at **Dashboard → Payment methods → Link** — this is a Checkout
setting, not code, and gives returning customers autofilled
email/address/payment on future visits.

## Webhook registration

1. Register an endpoint at `https://www.betterleftunsaid2.com/api/stripe-webhook`
   listening for `checkout.session.completed`.
2. Set the signing secret as `STRIPE_WEBHOOK_SECRET` in Vercel.
3. The handler disables Vercel's automatic body parsing
   (`handler.config = { api: { bodyParser: false } }`) because signature
   verification needs the *raw* request body, not re-serialized JSON — this
   is already wired, just don't "simplify" it away.

## Local testing

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

See `docs/shop-testing.md` for the full local-testing walkthrough,
including firing a duplicate event to confirm idempotency.
