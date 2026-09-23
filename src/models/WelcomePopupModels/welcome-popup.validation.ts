import { z } from "zod";
import { WELCOME_POPUP_CTA_MODE_VALUES, WELCOME_POPUP_STATUS_VALUES, WELCOME_POPUP_TEMPLATE_VALUES } from "../../constants/database.constants.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { InvalidWelcomePopupIdError } from "./welcome-popup.errors.js";

export function parseWelcomePopupId(param: unknown): number {
  if (typeof param !== "string") {
    throw new InvalidWelcomePopupIdError();
  }
  try {
    return parseStrictIdClaim(param);
  } catch {
    throw new InvalidWelcomePopupIdError();
  }
}

// Same rule as AnnouncementBarModels' linkUrlSchema: an absolute http(s) URL,
// or a site-relative path starting with "/" — never a scheme our own layout
// can't safely hand to <a href>.
const ctaUrlSchema = z
  .string()
  .trim()
  .max(1000, "CTA URL cannot exceed 1000 characters.")
  .refine((value) => /^https?:\/\//iu.test(value) || /^\/(?![\\/\\\\])/u.test(value), {
    message: "CTA URL must be an absolute http(s) URL or start with '/'."
  })
  .nullable();

const mediaIdSchema = z.number().int().positive("Media asset ID must be a positive integer.").nullable();
const imageAltSchema = z.string().trim().max(255, "Image alt text cannot exceed 255 characters.").nullable();
const displayDelaySchema = z.number().int().min(0).max(60_000, "Display delay cannot exceed 60 seconds.");
const dismissalCooldownSchema = z.number().int().min(0).max(365, "Dismissal cooldown cannot exceed 365 days.");
const couponIdSchema = z.number().int().positive("Coupon ID must be a positive integer.").nullable();

export const CreateWelcomePopupSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160, "Name cannot exceed 160 characters."),
  template: z.enum(WELCOME_POPUP_TEMPLATE_VALUES),
  heading: z.string().trim().min(1, "Heading is required.").max(200, "Heading cannot exceed 200 characters."),
  description: z.string().trim().max(2000, "Description cannot exceed 2000 characters.").nullable().optional(),
  offerLabel: z.string().trim().max(100, "Offer label cannot exceed 100 characters.").nullable().optional(),
  couponId: couponIdSchema.optional(),
  ctaMode: z.enum(WELCOME_POPUP_CTA_MODE_VALUES).default("email_signup"),
  ctaLabel: z.string().trim().min(1, "Button text is required.").max(60, "Button text cannot exceed 60 characters.").optional(),
  ctaUrl: ctaUrlSchema.optional(),
  displayDelayMs: displayDelaySchema.default(1200),
  dismissalCooldownDays: dismissalCooldownSchema.default(7),
  consentText: z.string().trim().max(500, "Consent text cannot exceed 500 characters.").nullable().optional(),
  dismissLabel: z.string().trim().max(60, "Dismiss-button text cannot exceed 60 characters.").nullable().optional(),
  desktopImageId: mediaIdSchema.optional(),
  desktopImageAlt: imageAltSchema.optional(),
  mobileImageId: mediaIdSchema.optional(),
  mobileImageAlt: imageAltSchema.optional()
}).superRefine((value, context) => {
  if (value.ctaMode === "navigation" && !value.ctaUrl) {
    context.addIssue({ code: "custom", path: ["ctaUrl"], message: "CTA URL is required for navigation." });
  }
});

export const UpdateWelcomePopupSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160, "Name cannot exceed 160 characters.").optional(),
  template: z.enum(WELCOME_POPUP_TEMPLATE_VALUES).optional(),
  heading: z.string().trim().min(1, "Heading is required.").max(200, "Heading cannot exceed 200 characters.").optional(),
  description: z.string().trim().max(2000, "Description cannot exceed 2000 characters.").nullable().optional(),
  offerLabel: z.string().trim().max(100, "Offer label cannot exceed 100 characters.").nullable().optional(),
  couponId: couponIdSchema.optional(),
  ctaMode: z.enum(WELCOME_POPUP_CTA_MODE_VALUES).optional(),
  ctaLabel: z.string().trim().min(1, "Button text is required.").max(60, "Button text cannot exceed 60 characters.").optional(),
  ctaUrl: ctaUrlSchema.optional(),
  displayDelayMs: displayDelaySchema.optional(),
  dismissalCooldownDays: dismissalCooldownSchema.optional(),
  consentText: z.string().trim().max(500, "Consent text cannot exceed 500 characters.").nullable().optional(),
  dismissLabel: z.string().trim().max(60, "Dismiss-button text cannot exceed 60 characters.").nullable().optional(),
  desktopImageId: mediaIdSchema.optional(),
  desktopImageAlt: imageAltSchema.optional(),
  mobileImageId: mediaIdSchema.optional(),
  mobileImageAlt: imageAltSchema.optional()
});

export const ListAdminWelcomePopupsQuerySchema = z.object({
  status: z.enum(WELCOME_POPUP_STATUS_VALUES).optional()
});
