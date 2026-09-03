import { z } from "zod";

import { FULFILMENT_STATUS_VALUES, ORDER_STATUS_VALUES, PAYMENT_STATUS_VALUES } from "../../constants/database.constants.js";
import { addressFieldsSchema } from "../AddressModels/address.validation.js";
import { CHECKOUT_PAYMENT_METHOD_VALUES } from "../CheckoutModels/checkout.types.js";
import { GuestOrderNotFoundError, InvalidOrderIdError } from "./order.errors.js";

export function parseOrderId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidOrderIdError();
}

// Matches the exact shape generated in order.service.ts (crypto.randomBytes(32).toString("hex")),
// the same convention the guest Cart cookie already uses. Malformed input is
// rejected as GuestOrderNotFoundError (not a validation error) so a
// malformed token and an unknown-but-well-formed token are indistinguishable
// to the caller — no extra information leaks from the shape of the response.
export const GUEST_ORDER_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function parseGuestOrderToken(rawToken: unknown): string {
  if (typeof rawToken === "string" && GUEST_ORDER_TOKEN_PATTERN.test(rawToken)) {
    return rawToken;
  }
  throw new GuestOrderNotFoundError();
}

// Exactly one of savedAddressId / shippingAddress — never both, never neither.
// shippingAddress reuses the same addressFieldsSchema Checkout Preview already
// validates with, so an inline address accepted by Preview is guaranteed
// acceptable here too.
export const createOrderSchema = z
  .object({
    savedAddressId: z.number().int().positive("savedAddressId must be a positive integer").optional(),
    shippingAddress: addressFieldsSchema.optional(),
    contactEmail: z.string().email().optional(),
    paymentMethod: z.enum(CHECKOUT_PAYMENT_METHOD_VALUES).optional()
  })
  .refine((data) => (data.savedAddressId !== undefined) !== (data.shippingAddress !== undefined), {
    message: "Provide exactly one of savedAddressId or shippingAddress.",
    path: ["shippingAddress"]
  });

const positiveQueryInteger = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryPageSize = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().min(1).max(100)
);

const queryDate = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Must be a valid date");

export const customerOrderListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  status: z.enum(ORDER_STATUS_VALUES).optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
  // Order number only (never customer name/email — see CustomerOrderListQuery).
  search: z.string().trim().min(1).max(190).optional()
});

export const adminOrderListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().min(1).max(190).optional(),
  status: z.enum(ORDER_STATUS_VALUES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
  fulfilmentStatus: z.enum(FULFILMENT_STATUS_VALUES).optional(),
  productId: positiveQueryInteger.optional(),
  state: z.string().trim().min(1).max(120).optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
  sortBy: z.enum(["placedAt", "total"]).optional(),
  sortDir: z.preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), z.enum(["ASC", "DESC"])).optional()
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES)
});

export const addOrderNoteSchema = z.object({
  message: z.string().trim().min(1, "Note message is required").max(2000, "Note message max 2000 characters")
});

export const bulkUpdateOrderStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  status: z.enum(ORDER_STATUS_VALUES)
});

// Mirrors AddressModels/address.validation.ts's baseAddressObjectSchema
// field-for-field (same limits/messages for name/phone/line1/line2/city/
// state) rather than importing it directly — that schema already has
// .superRefine() applied (Zod v4 can't .omit()/.extend() a refined schema),
// and this endpoint intentionally diverges on two points: no
// latitude/longitude (never accepted here — see UpdateOrderShippingAddressInput),
// and a stricter postalCode format. The 6-digit Indian pincode regex matches
// ShipmentModels/shipment.service.ts's own collectOrderReadinessIssues check
// exactly, so an address accepted here can never again fail that pre-flight
// shipment validation on pincode format alone.
export const updateOrderShippingAddressSchema = z.object({
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
