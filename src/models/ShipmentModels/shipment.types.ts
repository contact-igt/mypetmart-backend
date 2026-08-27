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
// field — nothing invented (no id/ETA/COD-charge: iThink's rate response
// doesn't carry a distinct courier id, and this integration doesn't parse
// ETA or a per-courier COD-charge field). "carrier" (not the client's own
// "courier" key) to match the naming ShipmentJSON.carrier already uses for
// the same concept once a courier is actually booked.
export type ShipmentQuoteOptionJSON = { carrier: string; serviceType: string; rate: string };
export type ShipmentQuoteResultJSON = { options: ShipmentQuoteOptionJSON[] };

// Optional — a manual pick from a prior quote's options. Omitted entirely
// (both fields undefined) means "use the existing automatic cheapest-pick
// fallback", exactly as every caller behaved before this feature existed.
export type CreateShipmentSelectionInput = { carrier: string; serviceType: string } | undefined;
