import { z } from "zod";

import { NEWSLETTER_SUBSCRIBER_STATUS_VALUES } from "../../constants/database.constants.js";

export const subscribeSchema = z
  .object({
    email: z.string().trim().min(3).max(190).email(),
    source: z.string().trim().min(1).max(100).optional()
  })
  .strict();

export const verifySchema = z
  .object({
    token: z.string().trim().min(1)
  })
  .strict();

export const unsubscribeSchema = z
  .object({
    token: z.string().trim().min(1)
  })
  .strict();

export const resendUnsubscribeLinkSchema = z
  .object({
    email: z.string().trim().min(3).max(190).email()
  })
  .strict();

export const listSubscribersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.enum(NEWSLETTER_SUBSCRIBER_STATUS_VALUES).optional(),
  search: z.string().trim().min(1).max(190).optional()
});
