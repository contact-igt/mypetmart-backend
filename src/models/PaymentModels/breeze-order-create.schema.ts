import { z } from "zod";

// Breeze "Order Create Webhook" (docs.breeze.in/order-create-webhook) — the
// exact documented shape, nothing more. z.object() STRIPS unknown keys, so an
// undocumented field (or alias such as eventData/data) can never become an
// authoritative input.
//
// Deliberate, documented leniency: fields the docs list as mandatory but that
// MyPetMart never depends on (address metadata such as id/customerId/source/
// isDefault/isVerified/isActive/createdAt/updatedAt, offers' inner fields) are
// accepted when absent. Rejecting an otherwise valid, authenticated webhook for
// a metadata field we do not use could strand a captured payment; every field
// we DO depend on is strictly required below.

const text = (max = 255) => z.string().trim().min(1).max(max);
const optionalText = (max = 255) => z.string().trim().max(max).optional();

export const breezeAddressSchema = z.object({
  id: optionalText(190),
  customerId: optionalText(190),
  name: text(160),
  line1: text(255),
  line2: z.string().trim().max(255).nullish(),
  city: text(120),
  district: optionalText(120),
  state: text(120),
  country: text(8),
  postalCode: text(16),
  type: optionalText(40),
  phoneNumber: text(32),
  countryCode: optionalText(8),
  emailAddress: z.string().trim().max(255).nullish(),
  source: optionalText(80),
  sourceIdentifier: z.string().trim().max(190).nullish(),
  isDefault: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  isActive: z.boolean().optional(),
  createdAt: optionalText(64),
  updatedAt: optionalText(64)
});

export const breezeOrderCreateSchema = z.object({
  id: text(190),
  eventName: text(80),
  content: z.object({
    orderId: text(190),
    txnId: z.string().trim().min(1).max(190).optional(),
    status: z.string().trim().min(1).max(40).optional(),
    offers: z.array(z.object({ id: optionalText(190), code: optionalText(80), discount: z.number().optional() })),
    payment: z.object({
      paymentMethod: text(80),
      paymentMethodType: text(80),
      // Documented as "Number". A string is NOT accepted: an unspecified
      // representation must not reach financial comparison.
      amount: z.number().finite().nonnegative(),
      currency: text(3)
    }),
    billingAddress: breezeAddressSchema,
    shippingAddress: breezeAddressSchema,
    shippingDetails: z.object({ rate: z.number().optional(), rateType: optionalText(40), provider: optionalText(80) }).optional(),
    customer: z.object({
      customerId: text(190),
      phoneNumber: text(32),
      countryCode: text(8),
      name: z.string().trim().max(160).nullish(),
      emailAddress: z.string().trim().max(255).nullish(),
      scope: optionalText(80)
    }),
    cart: z.object({
      id: text(64),
      breezeCartId: text(190),
      customerId: optionalText(190),
      initialPrice: z.number().finite().nonnegative(),
      totalPrice: z.number().finite().nonnegative(),
      totalDiscount: z.number().finite().nonnegative(),
      itemCount: z.number().int().nonnegative(),
      items: z.array(z.object({ id: optionalText(190), title: optionalText(255), quantity: z.number().int().positive().optional() })),
      currency: text(3)
    }),
    gstDetails: z.object({ gstIn: optionalText(32), companyName: z.string().max(255).nullish() }).optional()
  })
});

export type BreezeOrderCreatePayload = z.infer<typeof breezeOrderCreateSchema>;

/** Only the documented event name is treated as an order-create event. */
export const BREEZE_ORDER_CREATE_EVENT_NAMES = ["ORDER_SUCCEEDED"] as const;

/** Breeze Order Status vocabulary (docs.breeze.in/order-status). */
export const BREEZE_ORDER_STATUSES = [
  "CREATED",
  "PENDING",
  "PAYMENT_SUCCESS",
  "SUCCESS",
  "PARTIALLY_PAID",
  "FAILED",
  "CANCELLED",
  "AUTO_CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "AUTO_REFUNDED"
] as const;
export type BreezeOrderStatusName = (typeof BREEZE_ORDER_STATUSES)[number];

export type BreezeStatusClass = "paid" | "unpaid_pending" | "partial" | "failed" | "refund" | "unknown";

/**
 * Class of a webhook. Money is only ever classed "paid" from an EXPLICIT status.
 * The docs mark `status` optional and document no rule that an event name alone
 * proves payment, so an absent status is "unknown" (held for reconciliation),
 * never inferred as success. PAYMENT_SUCCESS and SUCCESS are both "paid" for
 * MyPetMart (money captured); the raw status is kept in event metadata.
 */
export function classifyBreezeStatus(eventName: string, status: string | undefined): BreezeStatusClass {
  void eventName; // event name is not treated as payment evidence
  const normalized = (status ?? "").trim().toUpperCase();
  if (normalized === "") {
    return "unknown";
  }
  switch (normalized) {
    case "PAYMENT_SUCCESS":
    case "SUCCESS":
      return "paid";
    case "CREATED":
    case "PENDING":
      return "unpaid_pending";
    case "PARTIALLY_PAID":
      return "partial";
    case "FAILED":
    case "CANCELLED":
    case "AUTO_CANCELLED":
      return "failed";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "AUTO_REFUNDED":
      return "refund";
    default:
      return "unknown";
  }
}
