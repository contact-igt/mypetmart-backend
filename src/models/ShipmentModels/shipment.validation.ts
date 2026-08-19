import { z } from "zod";

import { SHIPMENT_SOURCE_TYPE_VALUES, SHIPMENT_STATUS_VALUES } from "../../constants/database.constants.js";

export function parseShipmentId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new z.ZodError([{ code: "custom", path: ["shipmentId"], message: "A positive shipment id is required." }]);
  return id;
}

export const shipmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(SHIPMENT_STATUS_VALUES).optional(),
  sourceType: z.enum(SHIPMENT_SOURCE_TYPE_VALUES).optional(),
  courier: z.string().trim().min(1).max(120).optional()
});

export const reattemptSchema = z.object({
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u, "time must use HH:mm:ss.")
});

export const rtoSchema = z.object({ reason: z.string().trim().min(3).max(500) });
