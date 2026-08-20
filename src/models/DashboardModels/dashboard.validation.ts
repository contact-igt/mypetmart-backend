import { z } from "zod";

import { ORDER_STATUS_VALUES } from "../../constants/database.constants.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const numericQueryId = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryBoolean = z.preprocess((value) => value === "true" || value === true, z.boolean());

export const dashboardSummaryQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    compare: queryBoolean.optional().default(false),
    productId: numericQueryId.optional(),
    orderStatus: z.enum(ORDER_STATUS_VALUES).optional(),
    state: z.string().trim().min(1).max(120).optional()
  })
  .refine((data) => new Date(data.from).getTime() <= new Date(data.to).getTime(), {
    message: "from must not be after to",
    path: ["from"]
  });
