# Adding a new fulfillment provider

The provider abstraction (`lib/fulfillment/`) exists so this is additive,
not a rewrite. To add a provider (call it `newco`):

1. Add `'newco'` to the `FulfillmentProviderName` union in
   `lib/fulfillment/types.js`.
2. Write `newco-provider.js` implementing the shared shape used by
   `self-provider.js`/`apliiq-provider.js`/`printful-provider.js`:
   `name`, `isConfigured()`, `createOrder(request)`, `getOrder(providerOrderId)`,
   `normalizeStatus(raw)`. If the real API needs signed auth, split that
   into its own `newco-auth.js` (see `apliiq-auth.js`) and a thin HTTP
   client module (see `apliiq-client.js`) rather than inlining HTTP calls
   in the provider itself.
3. Register it in `lib/fulfillment/index.js`
   (`registry.registerFulfillmentProvider(newcoProvider)`).
4. **Verify the real API before writing the client** — don't invent
   endpoint paths, auth headers, or webhook payload shapes. Fetch the
   provider's current docs and note explicitly, in code comments and in a
   `docs/newco-setup.md`, what's confirmed vs. assumed. `apliiq-provider.js`
   and `docs/apliiq-setup.md` are the reference example: the auth scheme
   and order-creation endpoint were checked against Apliiq's live docs, and
   the two things that couldn't be confirmed (a status-polling endpoint, a
   generic webhook registration) are flagged rather than guessed at.
5. `groupItemsByProvider` (`lib/fulfillment/grouping.js`) and
   `api/stripe-webhook.js`'s per-group failure isolation (§12 in the
   original spec) need no changes — they're already generic over whatever
   provider name shows up in Stripe product metadata.
6. If the provider can push tracking/status updates, add
   `api/newco-webhook.js` following the same pattern as
   `api/apliiq-webhook.js`: validate the request (signed if the provider
   supports it, an unguessable token if not), look up the order via
   `findOrderByProviderOrderId` in `lib/order-log.js`, and tolerate
   duplicate delivery.
7. Add tests mirroring `tests/apliiq-mapping.test.js` — payload/address
   mapping and status normalization against fixtures, no live API calls.
