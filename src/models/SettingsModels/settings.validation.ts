import { z } from "zod";

export const storeProfileSchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required.").max(120),
  supportEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").max(190),
  supportPhone: z.string().trim().min(1, "Support phone is required.").max(30),
  address: z.string().trim().min(1, "Address is required.").max(500)
});
