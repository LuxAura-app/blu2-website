# Apliiq webhook endpoints

Apliiq's custom-store integration uses **four** distinct endpoints,
registered in Apliiq's dashboard under the custom store's settings (the
"link" icon on the Stores page → "add/update callback url" / "add/update
notification url" dialogs).

| Endpoint | Method | Auth | File |
|---|---|---|---|
| Fulfillment | POST | `x-apliiq-hmac` | `api/apliiq/fulfillment.js` |
| Warehouse Shipment Complete | POST | `x-apliiq-hmac` | `api/apliiq/warehouse-shipment-complete.js` |
| Product Search | GET | **none documented** | `api/apliiq/product-search.js` |
| Add to Store | POST | **none documented** | `api/apliiq/add-product.js` |

## HMAC verification (Fulfillment, Warehouse Shipment Complete)

```
hmac-value = base64_encode(HMACSHA256(base64_encode(payload), SHARED_SECRET))
```

Implemented in `lib/fulfillment/apliiq-hmac.js`'s `verifyApliiqHmac`,
compared against the `x-apliiq-hmac` request header with
`crypto.timingSafeEqual`. Requests are rejected with 401 **before** the
body is parsed or acted on.

### Open item — the "HMACSHA265" typo

Apliiq's own fulfillment doc names the algorithm `"HMACSHA265"`, which
doesn't exist. This build implements **HMAC-SHA256** as the only sensible
reading, but that substitution is unconfirmed with Apliiq support — ask
them directly before relying on it in a way that would silently fail
(e.g. don't assume a rejected webhook always means a bad actor; it could
mean Apliiq signs with something else entirely).

### Open item — which secret signs the request

Neither the Fulfillment nor Warehouse Shipment Complete docs say which
credential `SHARED_SECRET` refers to. This build reuses
`APLIIQ_SHARED_SECRET` (the same secret used for *outbound* auth signing
in `lib/fulfillment/apliiq-auth.js`) since it's the only shared secret
Apliiq issues for a custom store integration — but that's an assumption,
not a confirmed fact. Confirm with Apliiq support; if they use a distinct
inbound signing secret, add a new env var (e.g.
`APLIIQ_INBOUND_HMAC_SECRET`) and point `verifyApliiqHmac`'s callers at it
instead.

## `api/apliiq/fulfillment.js`

Request:

```json
{
  "fulfillment": {
    "order_id": "1569438492",
    "status": "success",
    "tracking_company": "USPS",
    "tracking_numbers": ["9400111699000516881728"],
    "tracking_urls": [],
    "line_items": [
      { "id": "1511138222", "quantity": 1, "sku": "APQ-1998244S7A1", "name": "..." }
    ]
  }
}
```

Looks up `apliiq-order:{order_id}`-equivalent via
`findOrderByProviderOrderId('apliiq', order_id)` (`lib/order-log.js`,
scans `orders:index` for a matching stored provider order id — no separate
lookup key is maintained, see docs/shop-architecture.md), then updates that
order's `providerStatus.apliiq` and `tracking.apliiq` (tracking numbers,
company, urls). Sends a shipped-notice alert the first time tracking
numbers appear on an order (deduped so repeat delivery doesn't re-notify).
Always responds `200 { ok: true }` — including when no matching order is
found, since there's nothing useful for Apliiq to retry.

## `api/apliiq/warehouse-shipment-complete.js`

**No example payload is given** in Apliiq's docs; they point to the same
article as Fulfillment without a distinct sample. Built defensively:
verifies the HMAC the same way, tries a few plausible id-shaped fields
(`order_id`, `id`, `orderId`, `order_number`, `fulfillment.order_id`) to
find a matching order, and stores the full raw payload in a
`warehouseShipmentComplete.history[]` array on that order record — this is
informational/logged, not something that drives a customer-facing status
change, until Apliiq support confirms the actual field names (especially
whatever indicates the "items correct or not" discrepancy the
plain-English description implies). If no order match is found, the
payload is only logged, not stored.

## `api/apliiq/product-search.js`

`GET /api/apliiq/product-search?search=<text>` — reads every catalog entry
(`lib/product-catalog.js`'s `listAllProducts`, **active and inactive** —
Apliiq may be searching for a product that hasn't been activated yet),
filters by case-insensitive substring match against `name`, responds:

```json
[{ "store_ProductId": "your-internal-product-id", "name": "...", "imageUrls": ["..."] }]
```

`store_ProductId` is **our** internal product id (the Redis catalog key),
not anything Apliiq-generated.

## `api/apliiq/add-product.js`

**Confirmed real shape (captured from a live Add to Store call) —
supersedes Apliiq's published docs example, which describes a flatter
shape (`name`/`variants` at the top level, `store_ProductId: null`) that
does not match what Apliiq actually sends:**

```json
{
  "ApliiqProductIds": [5989067],
  "product": {
    "name": "...",
    "description": "...",
    "imageUrls": ["..."],
    "sizes": ["..."],
    "colors": ["..."],
    "variants": [
      { "sku": "APQ-5989067S1A1", "price": 24.5, "color": "...", "size": "...", "weight": 0.4 }
    ]
  }
}
```

Everything product-shaped is nested under `product`; there is no
`store_ProductId` field anywhere in the real payload. For each variant in
`product.variants`, creates one Stripe Product + Price (metadata
`fulfillment_provider: apliiq`, `provider_variant_id: sku`; the payload's
`price` is used only as the Price's starting `unit_amount` — Apliiq's
cost/suggested price, not necessarily retail). Writes/updates the Redis
catalog entry via `upsertProduct`, always `active: false`. Responds:

```json
{ "storeProductId": "your-internal-product-id", "hasError": false, "errorMessages": [] }
```

or, on a validation/Stripe failure, `hasError: true` with human-readable
strings in `errorMessages` — this route never throws an unhandled 500,
since Apliiq's UI surfaces whatever is sent back.

### Resolved — the dedup key is `ApliiqProductIds[0]`, not `store_ProductId`

The originally-assumed `store_ProductId` field doesn't actually appear in
real payloads at all, so the "does it persist across calls" question is
moot — it was based on Apliiq's docs example, not reality. The real
payload's top-level `ApliiqProductIds[0]` is confirmed present and stable
across calls for the same product, and matches the numeric prefix shared
by all of that product's variant SKUs (`APQ-5989067S1A1` ↔
`ApliiqProductIds: [5989067]`). `handleAddProduct`
(`api/apliiq/add-product.js`) now keys the catalog entry as
`apliiq-{ApliiqProductIds[0]}` and stores it on the record as
`apliiqProductId`. `deriveInternalProductIdFromVariants`
(`lib/product-catalog.js`, keying off the shared SKU prefix instead) is
kept only as a fallback for the case — not yet observed in practice — where
`ApliiqProductIds` is missing.
