import type { ShipmentSourceType, ShipmentStatus } from "../../constants/database.constants.js";

export type ShipmentTrackingEventJSON = {
  id: number;
  status: ShipmentStatus;
  providerStatus: string;
  providerStatusCode: string | null;
  location: string | null;
  message: string | null;
  eventAt: string;
};

// Persisted into Shipment.raw_payload on a creation failure (see
// PaymentModels-style "no unnecessary migration" precedent — payment.service.ts's
// Payment table reuses free-text columns the same way). Success still uses
// raw_payload for its own shape ({ trackingUrl }) — the two never coexist on
// the same row since a fresh creation attempt overwrites raw_payload either
// way, and this type is only ever surfaced when it was actually a failure.
export type ShipmentFailureReasonJSON = {
  provider: string;
  errorCode: string;
  message: string;
  failedAt: string;
} | null;

export type ShipmentJSON = {
  id: number;
  shipmentNumber: string;
  sourceType: ShipmentSourceType;
  sourceId: number;
  orderId: number;
  replacementId: number | null;
  provider: string;
  providerOrderId: string | null;
  carrier: string | null;
  awbNumber: string | null;
  serviceType: string | null;
  status: ShipmentStatus;
  providerStatus: string | null;
  providerStatusCode: string | null;
  failureReason: ShipmentFailureReasonJSON;
  providerCost: string | null;
  currency: string;
  package: { weightGrams: number; lengthCm: string; widthCm: string; heightCm: string };
  // Captured once, from the courier candidate actually booked (iThink's
  // Rate API — verified live in Phase 2A.1). Deliberately NOT refreshed from
  // tracking sync — Track Order ETA fields are unconfirmed for this account
  // (Phase 2A.2 scope) and must not be implemented until verified the same
  // way. Null on every shipment created before this field existed, and on
  // any candidate iThink didn't supply an estimate for — never fabricated.
  deliveryTat: number | null;
  estimatedDelivery: { min: string; max: string } | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  rtoAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  trackingEvents: ShipmentTrackingEventJSON[];
};

// Customer-safe subset for order-listing previews — deliberately excludes
// provider_status/provider_status_code/failureReason (the same admin-only
// fields ShipmentJSON already withholds from customer detail views via
// its own toGuestOrderDetailJSON-style trimming elsewhere). trackingAvailable
// tells the frontend whether "Track shipment" can go anywhere useful, without
// this endpoint fetching (or the caller ever seeing) the underlying AWB here.
export type OrderShipmentSummaryJSON = {
  status: ShipmentStatus;
  carrier: string | null;
  trackingAvailable: boolean;
};

export type AdminShipmentListItemJSON = ShipmentJSON & {
  sourceReference: string;
  customerName: string;
};

export type AdminShipmentListResult = { items: AdminShipmentListItemJSON[]; total: number; page: number; pageSize: number; totalPages: number };

export type ReattemptInput = { date: string; time: string };
export type RtoInput = { reason: string };

// A single courier candidate from iThink's own Rate API response, field for
// field — nothing invented (no id/COD-charge: iThink's rate response
// doesn't carry a distinct courier id or a per-courier COD-charge field).
// "carrier" (not the client's own "courier" key) to match the naming
// ShipmentJSON.carrier already uses for the same concept once a courier is
// actually booked. deliveryTat/estimatedDelivery ARE parsed (Phase 2A.2,
// live-verified against the configured account) — null only when iThink's
// own response didn't supply them for this candidate/request, never guessed.
export type ShipmentQuoteOptionJSON = { carrier: string; serviceType: string; rate: string; deliveryTat: number | null; estimatedDelivery: { min: string; max: string } | null };
export type ShipmentQuoteResultJSON = { options: ShipmentQuoteOptionJSON[] };

// Optional — a manual pick from a prior quote's options. Omitted entirely
// (both fields undefined) means "use the existing automatic cheapest-pick
// fallback", exactly as every caller behaved before this feature existed.
export type CreateShipmentSelectionInput = { carrier: string; serviceType: string } | undefined;

// Customer-facing result of the storefront Product Detail "check delivery to
// your pincode" pre-purchase check. Deliberately a normalized, minimal shape:
// no courier names, no per-courier rate rows, no raw provider fields.
//   - serviceable:false  -> a valid pincode iThink cannot deliver to.
//     (A technical/provider failure is NOT this — it throws
//     DeliveryCheckUnavailableError instead, so the frontend can tell the two
//     apart per the "don't say 'unavailable' when the API is down" rule.)
//   - estimatedDelivery  -> iThink Rate API edd_date.min_edd / max_edd
//     verbatim (calendar dates), or null when the provider didn't supply a
//     window / the product has no package dimensions to rate against.
//   - deliveryCharge     -> the existing V1 storefront shipping rule
//     (V1_FREE_SHIPPING_FEE), never a new calculation and never the raw
//     per-courier iThink rate. null when not serviceable.
export type DeliveryCheckResultJSON = {
  pincode: string;
  serviceable: boolean;
  estimatedDelivery: { min: string; max: string } | null;
  deliveryCharge: { free: boolean; amount: string; currency: string } | null;
};
