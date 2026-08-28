import { InvalidReturnIdError } from "../ReturnModels/return.errors.js";

// Mirrors return.validation.ts's own parseReturnId exactly — kept as its own
// small copy (not a cross-import) since a return_shipment id and a
// return_request id are different identifier spaces that happen to share
// the same positive-integer shape; ReturnShipmentModels resolves everything
// it needs by return_request_id (see return-shipment.service.ts), so this
// exists for the one admin route keyed directly by return shipment id.
export function parseReturnShipmentId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/u.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  throw new InvalidReturnIdError();
}
