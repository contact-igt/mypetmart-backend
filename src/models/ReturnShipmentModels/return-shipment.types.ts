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

export type ReturnShipmentJSON = {
  id: number;
  returnRequestId: number;
  shipmentNumber: string;
  provider: string;
  carrier: string | null;
  awbNumber: string | null;
  serviceType: string | null;
  status: ReturnShipmentStatus;
  providerStatus: string | null;
  failureReason: ReturnShipmentFailureReasonJSON;
  trackingUrl: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  trackingEvents: ReturnShipmentTrackingEventJSON[];
};
