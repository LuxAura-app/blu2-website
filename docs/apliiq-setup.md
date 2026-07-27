# Apliiq setup

## What's confirmed vs. not

Everything below the auth/create-order/status sections was verified against
Apliiq's own help portal (`help.apliiq.com`) while this integration was
built. A handful of things were **not** found anywhere in their published
docs and are called out explicitly rather than guessed at — see "Order
status updates" below and `docs/apliiq-webhooks.md` before you rely on any
of them.

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

### Order status updates — confirmed, four endpoints

The four Apliiq webhook endpoints (Fulfillment, Warehouse Shipment
Complete, Product Search, Add to Store), their payload shapes, the HMAC
verification scheme, and the open items still needing Apliiq support
confirmation are documented in full in `docs/apliiq-webhooks.md` — read
that before registering callback URLs in Apliiq's dashboard.

One thing still unverified regardless of the four webhooks above:

- **A GET-order-status endpoint.** `lib/fulfillment/apliiq-client.js`'s
  `getOrder()` guesses `GET /v1/Order/{id}` by analogy with the confirmed
  `POST /v1/Order`, but this is unverified — don't build anything that
  depends on it working until you've confirmed it against a real account
  or with Apliiq support. Order status is otherwise driven by the
  Fulfillment webhook (`api/apliiq/fulfillment.js`) or Apliiq's own
  dashboard.

## Mapping a product/variant into Stripe

Products are **not** manually entered into `shop.html` anymore. The real
flow, once the four webhook URLs are registered (`docs/apliiq-webhooks.md`):

1. Build the product in Apliiq's own product builder (sizes, colors,
   pricing, images).
2. Click Apliiq's **"Add to Store"** button and select your custom store.
3. Apliiq POSTs the full product/variant payload — including every real
   `APQ-########S#A#` SKU — to `api/apliiq/add-product.js`.
4. That endpoint automatically creates a Stripe Product/Price per variant
   and writes a Redis catalog entry (`lib/product-catalog.js`), always
   `active: false`.
5. Review pricing (Apliiq's submitted price is their cost/suggested price,
   not necessarily your retail price) and images.
6. Run `node scripts/validate-products.js` (with `STRIPE_SECRET_KEY` set) —
   it won't stop at the first problem, so fix everything it lists.
7. Only then flip that catalog entry's `active` to `true` (directly in
   Redis for now — there's no admin UI for this in this pass).

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
