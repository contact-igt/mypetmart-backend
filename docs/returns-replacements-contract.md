# Returns, Refunds, and Replacements Contract

Runtime source of truth: Sequelize models, migrations, services, and tests. Older project briefs that describe Prisma or unimplemented returns are historical.

## Resolution model

`return_requests` remains the single item-level after-sales request. Its existing `type` column stores `return` for the Refund resolution and `replacement` for the Replacement resolution. The API exposes the clearer `resolution: refund | replacement` vocabulary; omitted values remain Refund for backward compatibility.

One OrderItem may have several requests only while the total quantity in `requested`, `approved`, or `resolved` requests does not exceed its immutable purchased quantity. Rejected requests release their quantity. This shared accounting permits purchased 2 → refunded 1 + replaced 1, but prevents either unit from being consumed twice.

## Eligibility and review

- Authenticated customer ownership, delivered Order status, configured return window, positive quantity, and remaining quantity are checked by the backend under an OrderItem row lock.
- Guest after-sales remains unsupported because no secure guest-return recovery contract exists.
- Admin and Super Admin may approve/reject requests. Only Super Admin may initiate a PayU refund.
- Refund initiation rejects Replacement resolution requests. Replacement creation rejects Refund resolution requests.

## Replacement lifecycle

Approval creates at most one `replacements` row for the Return Request:

- `stock_unavailable`: the same product/variant is unavailable; no stock, Refund, Payment, or PayU mutation occurred.
- `processing`: sellable inventory was atomically consumed exactly once.
- `completed`: an Admin manually confirmed operational completion; the Return Request becomes `resolved`.

The unique `return_request_id` constraint, Return Request lock, inventory row lock, and `stock_consumed_at` guard provide idempotency and concurrency safety. Stock-unavailable replacements can retry allocation. Returned inbound items are never automatically restocked.

## Commerce history and fulfilment boundary

Original Order, OrderItem snapshots, Payment amount/provider identifiers, and PayU history remain unchanged by Replacement. V1 replaces only with the same persisted product and variant identity and approved quantity; no exchange catalog, new payment, or automatic refund exists.

Shipment automation is not implemented. Replacement AWB, courier booking, tracking, return pickup, shipped/delivered automation, and cancellation/restock policy are deferred to the Shipping + Replacement Fulfilment module.
