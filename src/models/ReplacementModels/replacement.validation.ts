import { z } from "zod";

export const updateReplacementSchema = z.object({ status: z.literal("processing") });
