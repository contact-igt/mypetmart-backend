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

// Shared with CheckoutModels for inline guest/customer checkout addresses, so both
// modules validate address content identically instead of maintaining two schemas.
export const addressFieldsSchema = z.object({
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
    .default(DEFAULT_COUNTRY_CODE)
});

const labelSchema = z.string().trim().max(80, "Label must be at most 80 characters.").optional();

export const createAddressSchema = addressFieldsSchema.extend({
  label: labelSchema,
  isDefault: z.boolean().optional()
});

export const updateAddressSchema = addressFieldsSchema.partial().extend({
  label: labelSchema,
  isDefault: z.boolean().optional()
});
