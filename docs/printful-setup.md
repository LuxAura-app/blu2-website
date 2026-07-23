# Printful setup (Phase 2 — not required at launch)

Printful is scaffolded (`api/lib/fulfillment/printful-provider.js`,
registered in `api/lib/fulfillment/index.js`) but intentionally does
nothing yet: `isConfigured()` returns `false` until `PRINTFUL_API_KEY` is
set, and `createOrder`/`getOrder` throw a clear "not configured" error if
ever called before that. No product should be purchasable with
`fulfillmentProvider: "printful"` until it's active — `stripe-webhook.js`'s
per-provider failure isolation means an unconfigured Printful group logs
and alerts rather than blocking the rest of the order, but there's no
reason to let a customer buy something that will predictably fail.

Printful is meant for what Apliiq's catalog can't do: true all-over-print,
cut-and-sew, posters, art prints.

## Activating it later

1. Create a Printful store and get an API key from Printful's dashboard.
2. Upload artwork and create the products/variants in Printful; note each
   variant's Printful variant ID.
3. Implement `createOrder`/`getOrder` in `printful-provider.js` against
   Printful's current API docs — **verify the actual endpoints/auth scheme
   at the time**, the same way `apliiq-provider.js` was built against
   verified Apliiq docs rather than assumption (see docs/apliiq-setup.md
   for what that verification looked like in practice).
4. Set `PRINTFUL_API_KEY` (and `PRINTFUL_STORE_ID`/`PRINTFUL_WEBHOOK_SECRET`
   if the real API needs them) in Vercel.
5. In Stripe Product metadata for the relevant products, set
   `fulfillment_provider: "printful"` and `provider_variant_id` to the real
   Printful variant ID.
6. Flip that product's `PRODUCTS` entry in `shop.html` to `active: true`
   after `node scripts/validate-products.js` passes.

None of this requires touching the storefront, cart, or Stripe checkout
code — that's the point of the provider abstraction in
`api/lib/fulfillment/`.
