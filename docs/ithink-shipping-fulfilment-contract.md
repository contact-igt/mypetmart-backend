# iThink Shipping and Fulfilment Contract

Runtime source of truth: the current Sequelize models, migrations, services, and tests. This module covers forward fulfilment for paid Orders and approved Replacements. It does not implement return pickup or any other reverse-shipping flow.

## Architecture and ownership

MyPetMart remains the source of truth. An Order or Replacement is a fulfilment source, a MyPetMart `Shipment` is its durable provider-neutral fulfilment record, and `IThinkClient` is the only iThink V3 protocol adapter. Provider fields are not added to Order, Replacement, Payment, Refund, or browser-owned business logic.

Each Shipment has one `source_type`/`source_id`, an immutable underlying `order_id`, and either no `replacement_id` for an Order source or the matching `replacement_id` for a Replacement source. Database checks and unique keys enforce that invariant and allow at most one Shipment per source. Provider order references, provider shipment references, and AWBs are independently unique when present.

## Eligibility and lifecycle

Normal Orders require `payment_status=paid`, `status=confirmed`, no commerce exception, no cancellation, and a non-terminal fulfilment state. Shipping never marks a Payment paid and never changes a paid Order total. Replacements require `status=processing` and `stock_consumed_at`; they use the original Order's immutable delivery snapshot and create no Payment or Refund.

The normalized statuses are:

`pending`, `provider_status_unknown`, `created`, `awb_assigned`, `pickup_pending`, `picked_up`, `in_transit`, `out_for_delivery`, `delivered`, `delivery_exception`, `ndr`, `rto_initiated`, `rto_in_transit`, `rto_delivered`, `cancelled`, and `failed`.

Courier scans append to `shipment_tracking_events`. A SHA-256 key over provider status, code, location, message, and event timestamp makes ingestion idempotent. Events are displayed chronologically. Normalized status progression is monotonic, with explicit forward transitions for NDR reattempt and RTO; stale scans cannot regress a terminal Shipment.

Provider-verified delivery changes a normal Order to `status=delivered` and `fulfilment_status=delivered`, without Payment mutation. Provider-verified delivery of a Replacement completes it and resolves the approved Return Request exactly once.

## Product and package data

Product and ProductVariant shipping data is stored as grams and centimetres. Positive variant measurements override Product defaults. Active catalog validation and Admin forms already maintain these values.

V1 produces one rectangular parcel: total weight is the sum of unit weights; the footprint uses the largest item length and width; unit heights are stacked and summed. This declared strategy is used consistently for rate and booking requests. iThink's documented V3 rate limits of 10 kg and 1,000 cm per dimension are enforced. MyPetMart never invents missing measurements.

## Provider configuration and V3 operations

The backend owns `ITHINK_ACCESS_TOKEN`, `ITHINK_SECRET_KEY`, provider base URLs, pickup and return address IDs, origin pincode, and timeout. The Admin configuration response contains only provider name, configured/not-configured state, environment, and warehouse ID. Requests and credentials are never returned to a browser or persisted in Shipment payloads.

The adapter uses only these iThink Logistics V3 operations:

- pincode check: `/api_v3/pincode/check.json`
- rate check: `/api_v3/rate/check.json`
- add order: `/api_v3/order/add.json`
- tracking: `/api_v3/order/track.json`
- cancellation: `/api_v3/order/cancel.json`
- NDR reattempt/RTO: `/api_v3/ndr/add-reattempt-rto.json`

Both normal and Replacement outbound bookings are `forward` and `prepaid`. A serviceable prepaid pickup courier with the lowest returned rate is selected. That provider cost is stored on Shipment for operations. The customer `Order.shipping_fee` remains the current V1 value, INR 0.00, and paid totals are never recalculated.

## Idempotency and network uncertainty

Creation first locks the fulfilment source, writes one local pending Shipment, and commits. No database transaction stays open during an iThink network call. A repeat or concurrent request returns the same non-failed local Shipment and does not issue a second Add Order request.

An explicit provider rejection safely marks the local Shipment failed and permits an intentional retry using the same shipment identity. If a mutating provider request receives no response—or Add Order succeeds without an AWB—the Shipment becomes `provider_status_unknown`. The API refuses blind creation retry; an operator must reconcile it. The documented V3 order-details contract requires an AWB, so it cannot reliably reconcile an uncertain Add Order by MyPetMart shipment number alone.

Cancellation is limited to AWB-assigned/pickup-pending Shipments. Reattempt and RTO are limited to NDR/delivery-exception Shipments. RTO never creates a Refund or changes Payment state.

## UI and API boundary

Secure existing Order/guest recovery DTOs embed a Shipment only after their existing ownership/token checks. Return detail embeds Replacement tracking under the same authenticated customer ownership. Admin exposes list/detail, create, refresh, cancel, reattempt, and RTO routes behind the existing Admin authentication boundary. Admin Order and Replacement detail reuse one Shipment panel.

Label and manifest APIs are deferred because the current warehouse workflow did not establish them as launch requirements. Reverse pickup, reverse AWB, and inbound return tracking are explicitly deferred.
