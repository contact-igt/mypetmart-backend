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

export type AdminShipmentListItemJSON = ShipmentJSON & {
  sourceReference: string;
  customerName: string;
};

export type AdminShipmentListResult = { items: AdminShipmentListItemJSON[]; total: number; page: number; pageSize: number; totalPages: number };

export type ReattemptInput = { date: string; time: string };
export type RtoInput = { reason: string };
