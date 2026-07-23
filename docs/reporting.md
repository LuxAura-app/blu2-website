# Reporting

This is intentionally simple — a denormalized Redis order log, not
analytics infrastructure. If you outgrow it (multi-month trends, joins,
filters beyond a date range), the natural upgrade path is exporting these
Redis records into a proper Postgres table (e.g. Supabase): the record
shape below is already close to a table row, so that migration is
additive, not a rewrite.

## Redis schema (`lib/order-log.js`)

- `order:{stripeSessionId}` — a JSON string:
  ```json
  {
    "stripeSessionId": "cs_...",
    "name": "...", "email": "...", "phone": "...",
    "marketingConsent": true,
    "items": [{ "name": "...", "qty": 1, "unitPriceCents": 4500, "provider": "apliiq" }],
    "totalCents": 4500, "currency": "usd",
    "providerOrderIds": { "apliiq": "567890" },
    "timestamp": 1732000000000
  }
  ```
- `orders:index` — a sorted set of every `stripeSessionId`, scored by
  `timestamp`, so a date range can be pulled with a score-range query.
- `contacts:index` — a **separate** sorted set, same scoring, but only
  containing sessions where `marketingConsent === true`. Kept distinct from
  `orders:index` on purpose so a contact export can never accidentally
  include someone who didn't opt in.

## Querying it

`GET /api/admin/orders-report` (bearer token = `ADMIN_REPORT_TOKEN`),
optional `?from=`/`?to=` (ISO date strings, default: last 30 days):

```bash
curl -H "Authorization: Bearer $ADMIN_REPORT_TOKEN" \
  "https://www.betterleftunsaid2.com/api/admin/orders-report?from=2026-01-01&to=2026-02-01"
```

Returns `{ orderCount, revenueCents, unitsByProduct, revenueByProvider, ordersByProvider }`.

`GET /api/admin/contacts-export` (same token), optional `?from=`/`?to=`/`?format=csv|json`
(default CSV) — only ever includes consented contacts, for importing into
whatever email/SMS tool you pick later. Sending the actual campaigns is out
of scope for this build; this only captures clean, consented contact data.

## What this doesn't do

No multi-month trend charts, no cross-referencing against ad spend, no
cohort analysis. If you need that, export `orders:index` into Postgres and
query it there — don't grow this endpoint into a BI tool.
