import { z } from "zod";

export const updateReplacementSchema = z.object({ status: z.enum(["processing", "completed"]) });
