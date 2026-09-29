import { z } from "zod";

// Two decimal places at most — percent (10.50) or rupees (99.99). Parsed to
// integer basis points / paise without floating-point arithmetic.
const DECIMAL_VALUE_PATTERN = /^\d{1,9}(\.\d{1,2})?$/u;
// ₹10,00,000 upper bound keeps paise comfortably inside INT UNSIGNED.
export const MAX_FIXED_ONLINE_DISCOUNT_PAISE = 100_000_000;

export function decimalStringToHundredths(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export const payOnlineDiscountSchema = z
  .object({
    enabled: z.boolean(),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z
      .union([z.string(), z.number()])
      .transform((value) => String(value).trim())
      .refine((value) => DECIMAL_VALUE_PATTERN.test(value), "Enter a number with at most 2 decimal places.")
  })
  .superRefine((input, ctx) => {
    if (!DECIMAL_VALUE_PATTERN.test(input.discountValue)) return;
    const hundredths = decimalStringToHundredths(input.discountValue);
    // A disabled discount may keep a 0 value — it never affects pricing. An
    // enabled one must be a real discount. The upper bounds always apply.
    if (input.enabled && hundredths <= 0) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Discount value must be greater than 0." });
    } else if (input.discountType === "percentage" && hundredths > 10_000) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage cannot exceed 100%." });
    } else if (input.discountType === "fixed" && hundredths > MAX_FIXED_ONLINE_DISCOUNT_PAISE) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Fixed amount cannot exceed ₹10,00,000." });
    }
  });

export type PayOnlineDiscountInput = z.infer<typeof payOnlineDiscountSchema>;

export const storeProfileSchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required.").max(120),
  supportEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").max(190),
  supportPhone: z.string().trim().min(1, "Support phone is required.").max(30),
  address: z.string().trim().min(1, "Address is required.").max(500)
});
