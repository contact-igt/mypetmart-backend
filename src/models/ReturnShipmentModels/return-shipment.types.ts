import type { ReturnShipmentStatus } from "../../constants/database.constants.js";

export type ReturnShipmentTrackingEventJSON = {
  id: number;
  status: ReturnShipmentStatus;
  providerStatus: string;
  providerStatusCode: string | null;
  location: string | null;
  message: string | null;
  eventAt: string;
};

// Customer- and admin-safe alike — deliberately smaller than ShipmentJSON
// (no package/providerCost/source fields a reverse pickup has no use for).
// null failureReason mirrors ShipmentJSON's own pattern: only ever populated
// on a genuine booking rejection, never fabricated.
export type ReturnShipmentFailureReasonJSON = {
  provider: string;
  errorCode: string;
  message: string;
  failedAt: string;
} | null;

// A single reverse-capable courier candidate from iThink's Rate API
// (order_type: "reverse") — field-for-field the same shape as
// ShipmentModels' ShipmentQuoteOptionJSON. Nothing invented: rate is the raw
// per-courier reverse rate iThink returns, deliveryTat/estimatedDelivery are
// null when the provider didn't supply them for this candidate.
export type ReturnShipmentQuoteOptionJSON = { carrier: string; serviceType: string; rate: string; deliveryTat: number | null; estimatedDelivery: { min: string; max: string } | null };
export type ReturnShipmentQuoteResultJSON = { options: ReturnShipmentQuoteOptionJSON[] };

// Optional manual pick from a prior quote. Omitted (undefined) means "use the
// automatic cheapest reverse courier", exactly as createForApprovedReturn
// behaved before this feature.
export type CreateReturnShipmentSelectionInput = { carrier: string; serviceType: string } | undefined;

export type ReturnShipmentJSON = {
  id: number;
  returnRequestId: number;
  shipmentNumber: string;
  provider: string;
  carrier: string | null;
  awbNumber: string | null;
  serviceType: string | null;
  // The reverse shipping amount actually charged for this pickup — the rate
  // of the reverse courier candidate booked (iThink Rate API, order_type:
  // "reverse"), stored verbatim in return_shipments.shipping_charge. null
  // until a rate has been chosen (e.g. a booking that failed before rate
  // selection) — the UI shows an empty state, never a fabricated value.
  shippingAmount: string | null;
  currency: string;
  status: ReturnShipmentStatus;
  providerStatus: string | null;
  providerStatusCode: string | null;
  failureReason: ReturnShipmentFailureReasonJSON;
  trackingUrl: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  // Row last-modified time — used by the return-cancellation eligibility
  // check to age out a stranded "Booking in progress" marker.
  updatedAt: string;
  trackingEvents: ReturnShipmentTrackingEventJSON[];
};
