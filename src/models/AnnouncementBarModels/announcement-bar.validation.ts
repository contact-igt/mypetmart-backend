import { z } from "zod";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { InvalidAnnouncementBarItemIdError } from "./announcement-bar.errors.js";

export function parseAnnouncementBarItemId(param: unknown): number {
  if (typeof param !== "string") {
    throw new InvalidAnnouncementBarItemIdError();
  }
  try {
    return parseStrictIdClaim(param);
  } catch {
    throw new InvalidAnnouncementBarItemIdError();
  }
}

// A bare "http://…"/"https://…" absolute URL, or a site-relative path starting
// with "/" (e.g. "/shop?sort=newest") — never a scheme our own layout can't
// safely hand to <a href>.
const linkUrlSchema = z
  .string()
  .trim()
  .max(1000, "Link URL cannot exceed 1000 characters.")
  .refine((value) => /^https?:\/\//iu.test(value) || value.startsWith("/"), {
    message: "Link URL must be an absolute http(s) URL or start with '/'."
  })
  .nullable();

// The CTA text shown as its own link after the message (e.g. "Shop Now").
// Only meaningful alongside a linkUrl, but not required to be — a label with
// no link simply never renders as a link (see announcement-bar.service.ts).
const linkLabelSchema = z.string().trim().max(60, "Button text cannot exceed 60 characters.").nullable();

const scheduleFields = {
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional()
};

function validateSchedule(value: { startsAt?: string | null | undefined; endsAt?: string | null | undefined }, context: z.RefinementCtx) {
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End date must be after the start date." });
  }
}

export const CreateAnnouncementBarItemSchema = z.object({
  message: z.string().trim().min(1, "Message is required.").max(200, "Message cannot exceed 200 characters."),
  linkUrl: linkUrlSchema.optional(),
  linkLabel: linkLabelSchema.optional(),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0, "Display order must be non-negative.").optional(),
  ...scheduleFields
}).superRefine(validateSchedule);

export const UpdateAnnouncementBarItemSchema = z.object({
  message: z.string().trim().min(1, "Message is required.").max(200, "Message cannot exceed 200 characters.").optional(),
  linkUrl: linkUrlSchema.optional(),
  linkLabel: linkLabelSchema.optional(),
  active: z.boolean().optional(),
  ...scheduleFields
}).superRefine(validateSchedule);

export const ReorderAnnouncementBarItemSchema = z.object({
  itemId: z.number().int().positive("Item ID must be a positive integer."),
  displayOrder: z.number().int().min(0, "Display order must be a non-negative integer.")
});

export const AnnouncementBarReorderSchema = z.object({
  items: z
    .array(ReorderAnnouncementBarItemSchema)
    .min(1, "At least one item must be provided for reordering.")
    .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length, {
      message: "Duplicate item IDs are not allowed in reorder request."
    })
    .refine((items) => new Set(items.map((i) => i.displayOrder)).size === items.length, {
      message: "Duplicate display orders are not allowed in reorder request."
    })
});
