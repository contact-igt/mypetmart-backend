import { z } from "zod";
import { CONTACT_ENQUIRY_STATUS_VALUES } from "../../constants/database.constants.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { CONTACT_ENQUIRY_SUBJECT_VALUES } from "./contact.types.js";
import { InvalidContactEnquiryIdError } from "./contact.errors.js";

export function parseContactEnquiryId(param: unknown): number {
  if (typeof param !== "string") {
    throw new InvalidContactEnquiryIdError();
  }
  try {
    return parseStrictIdClaim(param);
  } catch {
    throw new InvalidContactEnquiryIdError();
  }
}

export const CreateContactEnquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160, "Name must be at most 160 characters."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Invalid email format.")
    .max(190, "Email must be at most 190 characters."),
  phone: z
    .string()
    .trim()
    .regex(/^[\d\s+\-()]*$/, "Invalid phone format.")
    .max(32, "Phone must be at most 32 characters.")
    .optional()
    .nullable()
    .or(z.literal("")),
  subject: z.enum(CONTACT_ENQUIRY_SUBJECT_VALUES, { message: "Select a valid enquiry type." }),
  orderNumber: z.string().trim().max(50, "Order number must be at most 50 characters.").optional().nullable().or(z.literal("")),
  message: z.string().trim().min(1, "Message is required.").max(4000, "Message must be at most 4000 characters.")
});

export const UpdateContactEnquirySchema = z.object({
  status: z.enum(CONTACT_ENQUIRY_STATUS_VALUES).optional(),
  adminNote: z.string().trim().max(4000, "Internal note must be at most 4000 characters.").nullable().optional()
});

const positiveQueryInteger = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryPageSize = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().min(1).max(100)
);

export const ListAdminContactEnquiriesQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  status: z.enum(CONTACT_ENQUIRY_STATUS_VALUES).optional()
});
