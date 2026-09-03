import { z } from "zod";

import { addressFieldsSchema } from "../AddressModels/address.validation.js";
import { CHECKOUT_PAYMENT_METHOD_VALUES } from "./checkout.types.js";

export const checkoutPreviewSchema = z
  .object({
    savedAddressId: z.number().int().positive().optional(),
    shippingAddress: addressFieldsSchema.optional(),
    billingSameAsShipping: z.boolean().optional().default(true),
    billingAddress: addressFieldsSchema.optional(),
    contactEmail: z.string().email().optional(),
    paymentMethod: z.enum(CHECKOUT_PAYMENT_METHOD_VALUES).optional()
  })
  .refine((data) => data.billingSameAsShipping || data.billingAddress !== undefined, {
    message: "billingAddress is required when billingSameAsShipping is false.",
    path: ["billingAddress"]
  });
