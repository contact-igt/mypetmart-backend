import { z } from "zod";

import { InvalidReturnIdError } from "./return.errors.js";

export function parseReturnId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidReturnIdError();
}

export const createReturnRequestSchema = z.object({
  orderId: z.number().int().positive("orderId must be a positive integer"),
  orderItemId: z.number().int().positive("orderItemId must be a positive integer"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
  reason: z.string().trim().min(1, "A return reason is required.").max(2000, "Reason must be 2000 characters or fewer.")
  ,resolution: z.enum(["refund", "replacement"]).default("refund")
});

export const adminReviewReturnSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().min(1).max(2000).optional()
});

export const addReturnNoteSchema = z.object({
  message: z.string().trim().min(1, "A note message is required.").max(2000, "Note must be 2000 characters or fewer.")
});

export const cancelReturnSchema = z.object({
  reason: z.string().trim().min(1, "A cancellation reason is required.").max(2000, "Reason must be 2000 characters or fewer.").optional()
}).default({});

// Reverse-pickup address override for a ReturnRequest. Copied field-for-field
// from OrderModels/order.validation.ts's updateOrderShippingAddressSchema
// (same limits/messages, same 6-digit Indian pincode regex, same >=10-digit
// phone rule) — kept as its own copy rather than a cross-import so the two
// address-edit surfaces can diverge independently, but staying byte-identical
// today means an address accepted here can never fail the shipment pre-flight
// pincode/phone checks in ShipmentModels either.
export const updateReturnPickupAddressSchema = z.object({
  recipientName: z.string().trim().min(1, "Recipient name is required.").max(160, "Recipient name must be at most 160 characters."),
  phone: z
    .string()
    .trim()
    .min(1, "Phone is required.")
    .max(32, "Phone must be at most 32 characters.")
    .regex(/^[\d\s+\-()]*$/, "Invalid phone format.")
    .refine((value) => value.replace(/\D/g, "").length >= 10, "Phone number must have at least 10 digits."),
  line1: z.string().trim().min(1, "Address line 1 is required.").max(255, "Address line 1 must be at most 255 characters."),
  line2: z.string().trim().max(255, "Address line 2 must be at most 255 characters.").optional(),
  city: z.string().trim().min(1, "City is required.").max(120, "City must be at most 120 characters."),
  state: z.string().trim().min(1, "State is required.").max(120, "State must be at most 120 characters."),
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, "Postal code must be a valid 6-digit Indian pincode.")
});

// Optional manual courier pick from a prior return-shipment quote — omitted
// entirely (both fields undefined) means "use the automatic cheapest reverse
// courier", exactly how ReturnShipmentService.createForApprovedReturn behaved
// before this feature. Mirrors ShipmentModels/shipment.validation.ts's
// createShipmentSchema, including the "both or neither" refine.
export const createReturnShipmentSchema = z
  .object({
    carrier: z.string().trim().min(1).max(120).optional(),
    serviceType: z.string().trim().min(1).max(120).optional()
  })
  .refine((data) => (data.carrier === undefined) === (data.serviceType === undefined), {
    message: "Provide both carrier and serviceType, or neither.",
    path: ["serviceType"]
  });

export const listReturnsQuerySchema = z.object({
  status: z.enum(["requested", "approved", "rejected", "resolved", "cancelled"]).optional(),
  resolution: z.enum(["refund", "replacement"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});
