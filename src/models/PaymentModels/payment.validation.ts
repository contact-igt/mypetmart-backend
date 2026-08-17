import { z } from "zod";

// Exactly one of the two — mirrors createOrderSchema's savedAddressId /
// shippingAddress refine pattern. Which one is actually required is further
// narrowed against the resolved caller identity inside the service
// (PaymentCustomerOrderIdRequiredError / PaymentGuestTokenRequiredError) —
// Zod alone cannot see whether a Bearer token was presented.
//
// guestAccessToken is deliberately NOT shape-validated against the guest
// token pattern here (unlike order.validation.ts's parseGuestOrderToken,
// which rejects a malformed token as a 400 before ever hashing it — that
// route's token arrives as a URL path segment and only ever means "look
// this up"). Here a malformed token instead flows straight through to
// TokenService.hashToken() and simply fails to match any Order, resolving
// to the same non-enumerating OrderNotFoundError as a well-formed-but-wrong
// token — a malformed and an unknown token are indistinguishable to the
// caller, matching the same anti-enumeration property the guest Order
// recovery route already established, just achieved without a regex gate.
export const initiatePaymentSchema = z
  .object({
    orderId: z.number().int().positive("orderId must be a positive integer").optional(),
    guestAccessToken: z.string().min(1).max(256).optional()
  })
  .refine((data) => (data.orderId !== undefined) !== (data.guestAccessToken !== undefined), {
    message: "Provide exactly one of orderId or guestAccessToken.",
    path: ["orderId"]
  });
