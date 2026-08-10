import { z } from "zod";
import { USER_STATUS_VALUES } from "../../constants/database.constants.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { InvalidCustomerIdError } from "./admin-customer.errors.js";

export const ListCustomersQuerySchema = z.object({
  page: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().min(1).optional().default(1)),
  limit: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().min(1).max(100).optional().default(20)),
  search: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUS_VALUES).optional(),
  sort: z.enum(["createdAt", "name", "lastLoginAt", "id"]).optional().default("createdAt"),
  order: z.enum(["ASC", "DESC"]).optional().default("DESC")
});

export function parseCustomerId(param: unknown): number {
  if (typeof param !== "string") {
    throw new InvalidCustomerIdError();
  }
  try {
    return parseStrictIdClaim(param);
  } catch {
    throw new InvalidCustomerIdError();
  }
}
