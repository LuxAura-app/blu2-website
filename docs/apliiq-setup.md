# Apliiq setup

## What's confirmed vs. not

Everything below the auth/create-order/status sections was verified against
Apliiq's own help portal (`help.apliiq.com`) while this integration was
built. Two things were **not** found anywhere in their published docs and
are called out explicitly rather than guessed at — see "Order status
updates" below before you rely on either.

### Authentication (confirmed)

Every request needs an `Authorization` header:

```
Authorization: x-apliiq-auth {RTS}:{SIG}:{APPID}:{STATE}
Accept: application/json
```

- `RTS` — unix timestamp in seconds
- `STATE` — a random nonce, unique per request
- `SIG` — `base64(HMAC-SHA256(APPId + RTS + STATE + base64(body), SharedSecret))`
  (concatenate those four strings directly, no separators; `body` is the
  raw request body, base64-encoded, or an empty string if there is none)
- `APPID` — your `APLIIQ_APP_ID`

Implemented in `lib/fulfillment/apliiq-auth.js`. **Never log
`APLIIQ_SHARED_SECRET`** or the string that gets signed — Apliiq's docs are
explicit that anyone with the shared secret can act on your account.

### Create Order (confirmed)

`POST https://api.apliiq.com/v1/Order`

Request body needs, at minimum: `id`, `number`, `order_number` (all three
set to our external reference — Apliiq's docs describe them slightly
redundantly and this build maps all three to the same value), `name`
(a friendly label), `line_items[]` (`id`, `title`, `quantity`, `price` in
dollars, `sku` in Apliiq's `APQ-########S#A#` format), and
`shipping_address` (`first_name`, `last_name`, `address1`, `city`, `zip`,
`province`/`province_code`, `country`/`country_code`).

Response is `{ "id": <apliiq order id> }`. Implemented in
`lib/fulfillment/apliiq-client.js` (`createOrder`) and mapped from our
internal `FulfillmentOrderRequest` shape in
`lib/fulfillment/apliiq-provider.js` (`buildApliiqOrderPayload`).

One approximation worth knowing: our internal address model only stores a
2-letter `stateCode`/`countryCode` (from Stripe's shipping address), but
Apliiq's schema wants both a code *and* a full name (`province`/`country`).
We currently send the code for both — correct for the `*_code` fields,
an approximation for the plain-name fields. If Apliiq ever rejects an order
over this, that's the first thing to check.

### Order statuses (confirmed)

`New`, `Preparing To Release`, `Ready To Release`, `In Production`,
`Ready To Ship`, `On Hold`, `Payment Pending`, `Shipped`.

### Order status updates — NOT confirmed

Two things could not be found anywhere in Apliiq's published docs, despite
a real search pass (not a guess):

1. **A GET-order-status endpoint.** `lib/fulfillment/apliiq-client.js`'s
   `getOrder()` guesses `GET /v1/Order/{id}` by analogy with the confirmed
   `POST /v1/Order`, but this is unverified — don't build anything that
   depends on it working until you've confirmed it against a real account
   or with Apliiq support.
2. **A generic webhook/callback URL setting for custom API integrations.**
   Every tracking-push doc found (e.g. "How does tracking and fulfillment
   work with dropshipping") describes automatic behavior specific to
   Apliiq's *Shopify app* — nothing about registering a callback URL for a
   custom REST integration like this one.

`api/apliiq-webhook.js` is built defensively (token-protected via
`?token=`, tolerant of duplicate delivery, validates an unknown payload
shape before using it) so it's ready *if* Apliiq can call it — but **ask
Apliiq support directly** whether a callback URL can be registered for a
custom integration before assuming this endpoint will ever receive traffic.
Until confirmed, the only reliable way to check order status is Apliiq's
own dashboard.

## Mapping a product/variant into Stripe

1. Create the product and its variants in Apliiq (or in your Apliiq
   dashboard's product catalog).
2. For each Stripe Price representing one variant (e.g. "Tee — Black — M"),
   set this Product metadata in the Stripe Dashboard:
   - `fulfillment_provider` = `apliiq`
   - `provider_variant_id` = the Apliiq SKU, format `APQ-########S#A#`
3. In `shop.html`'s `PRODUCTS` array, set that entry's `priceId` to the real
   Stripe Price ID and `providerVariantId` to the same Apliiq SKU (used for
   local logging/consistency — the source of truth for fulfillment is the
   Stripe metadata, read at webhook time).
4. Run `node scripts/validate-products.js` (with `STRIPE_SECRET_KEY` set) —
   it won't stop at the first problem, so fix everything it lists.
5. Only then flip that product's `active: false` to `active: true`.

## Test-order safeguards

Apliiq may not have a full sandbox environment, so test orders are real
orders. Do this manually — **never** from the automated test suite, which
is why `ALLOW_LIVE_APLIIQ_TEST_ORDERS` exists and must stay `false` in
production:

1. Use a single, clearly-labeled, lowest-cost test product.
2. Ship it to an address you control.
3. Know how to cancel it in the Apliiq dashboard before it enters
   production, in case something's wrong with the mapping.
4. Remember Stripe and Apliiq are two separate money movements — Stripe
   charges the customer, Apliiq separately charges the merchant billing
   method on file with them. Keep sufficient balance/credit with Apliiq
   independent of when Stripe pays out to you.
