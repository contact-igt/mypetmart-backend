import { z } from "zod";

import { DEFAULT_COUNTRY_CODE } from "../../constants/database.constants.js";
import { InvalidAddressIdError } from "./address.errors.js";

export function parseAddressId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidAddressIdError();
}

// ---------------------------------------------------------------------------
// Shared base field definitions (no refinements so .partial() can be applied)
// ---------------------------------------------------------------------------

const baseAddressObjectSchema = z.object({
  recipientName: z.string().trim().min(1, "Recipient name is required.").max(160, "Recipient name must be at most 160 characters."),
  phone: z
    .string()
    .trim()
    .min(1, "Phone is required.")
    .max(32, "Phone must be at most 32 characters.")
    .regex(/^[\d\s+\-()]*$/, "Invalid phone format."),
  line1: z.string().trim().min(1, "Address line 1 is required.").max(255, "Address line 1 must be at most 255 characters."),
  line2: z.string().trim().max(255, "Address line 2 must be at most 255 characters.").optional(),
  city: z.string().trim().min(1, "City is required.").max(120, "City must be at most 120 characters."),
  state: z.string().trim().min(1, "State is required.").max(120, "State must be at most 120 characters."),
  postalCode: z.string().trim().min(1, "Postal code is required.").max(20, "Postal code must be at most 20 characters."),
  country: z
    .string()
    .trim()
    .length(2, "Country must be a 2-letter code.")
    .optional()
    .default(DEFAULT_COUNTRY_CODE),
  latitude: z.number().min(-90, "Latitude must be >= -90.").max(90, "Latitude must be <= 90.").optional(),
  longitude: z.number().min(-180, "Longitude must be >= -180.").max(180, "Longitude must be <= 180.").optional()
});

// Shared with CheckoutModels for inline guest/customer checkout addresses, so both
// modules validate address content identically instead of maintaining two schemas.
// Coordinates are optional but must appear together (both or neither).
export const addressFieldsSchema = baseAddressObjectSchema.superRefine((data, ctx) => {
  const hasLat = data.latitude !== undefined;
  const hasLon = data.longitude !== undefined;
  if (hasLat && !hasLon) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "longitude is required when latitude is provided.", path: ["longitude"] });
  }
  if (hasLon && !hasLat) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "latitude is required when longitude is provided.", path: ["latitude"] });
  }
});

const labelSchema = z.string().trim().max(80, "Label must be at most 80 characters.").optional();

export const createAddressSchema = addressFieldsSchema.extend({
  label: labelSchema,
  isDefault: z.boolean().optional()
});

// ---------------------------------------------------------------------------
// Update schema — supports three coordinate states:
//   (a) both omitted     → preserve existing coordinates
//   (b) both numbers     → set/update coordinates
//   (c) both null        → explicitly clear coordinates
//   (d) mixed            → rejected
//
// We build from baseAddressObjectSchema (no refinements) so Zod v4 allows
// .partial(). Then we override lat/lon to also allow null, and add the
// update-specific pair constraint via a separate .superRefine().
// ---------------------------------------------------------------------------
export const updateAddressSchema = baseAddressObjectSchema
  .partial()
  .extend({
    label: labelSchema,
    isDefault: z.boolean().optional(),
    // Allow explicit null (clearing semantics) in addition to the number | undefined from base
    latitude: z.number().min(-90, "Latitude must be >= -90.").max(90, "Latitude must be <= 90.").nullable().optional(),
    longitude: z.number().min(-180, "Longitude must be >= -180.").max(180, "Longitude must be <= 180.").nullable().optional()
  })
  .superRefine((data, ctx) => {
    const latPresent = "latitude" in data && data.latitude !== undefined;
    const lonPresent = "longitude" in data && data.longitude !== undefined;
    const latNull = "latitude" in data && data.latitude === null;
    const lonNull = "longitude" in data && data.longitude === null;

    // Case: one is an explicit null, the other is a number → reject
    if (latNull && lonPresent && !lonNull) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "longitude must also be null when latitude is null.", path: ["longitude"] });
    }
    if (lonNull && latPresent && !latNull) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "latitude must also be null when longitude is null.", path: ["latitude"] });
    }
    // Case: one is a number, the other is absent → reject
    if (latPresent && !latNull && !lonPresent && !lonNull) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "longitude is required when latitude is provided.", path: ["longitude"] });
    }
    if (lonPresent && !lonNull && !latPresent && !latNull) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "latitude is required when longitude is provided.", path: ["latitude"] });
    }
  });
