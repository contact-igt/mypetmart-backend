import { z } from "zod";

// Destination pincode is the ONLY shipping detail the customer supplies. The
// origin pincode, courier, zone, payment mode and package dimensions are all
// resolved server-side (shippingConfig + the Product's own measurements).
//
// `^[1-9][0-9]{5}$` matches the exact Indian-pincode rule the existing
// shipment flow already enforces (collectOrderReadinessIssues in
// shipment.service.ts) — 6 digits, never leading zero.
export const deliveryCheckSchema = z.object({
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/u, "Enter a valid 6-digit pincode."),
  productId: z.coerce.number().int().positive(),
  variantId: z.coerce.number().int().positive().optional(),
  // Only affects the rated package weight/height for the ETA lookup — clamped
  // to the same 1..20 line-quantity ceiling the storefront cart enforces.
  quantity: z.coerce.number().int().min(1).max(20).optional()
});

export type DeliveryCheckInput = z.infer<typeof deliveryCheckSchema>;
