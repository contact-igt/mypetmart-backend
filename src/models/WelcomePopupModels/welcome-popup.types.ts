import type { WelcomePopupCtaMode, WelcomePopupStatus, WelcomePopupTemplate } from "../../constants/database.constants.js";

export type AdminWelcomePopupItem = {
  id: number;
  name: string;
  template: WelcomePopupTemplate;
  status: WelcomePopupStatus;
  isHomepageActive: boolean;
  heading: string;
  description: string | null;
  offerLabel: string | null;
  couponId: number | null;
  couponCode: string | null;
  ctaMode: WelcomePopupCtaMode;
  ctaLabel: string;
  ctaUrl: string | null;
  displayDelayMs: number;
  dismissalCooldownDays: number;
  consentText: string | null;
  dismissLabel: string | null;
  desktopImageUrl: string | null;
  desktopImageAlt: string | null;
  mobileImageUrl: string | null;
  mobileImageAlt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Public-safe subset only — no `name` (internal admin label), no `status`
// (a resolved popup is always implicitly published+active), no storage keys,
// no timestamps. Mirrors how StorefrontCategorySummary/StorefrontAnnouncementBarItem
// already trim their admin counterparts down for the public route.
export type StorefrontWelcomePopup = {
  id: number;
  template: WelcomePopupTemplate;
  heading: string;
  description: string | null;
  offerLabel: string | null;
  couponCode: string | null;
  ctaMode: WelcomePopupCtaMode;
  ctaLabel: string;
  ctaUrl: string | null;
  displayDelayMs: number;
  dismissalCooldownDays: number;
  consentText: string | null;
  dismissLabel: string | null;
  desktopImageUrl: string | null;
  desktopImageAlt: string | null;
  mobileImageUrl: string | null;
  mobileImageAlt: string | null;
};

export type CreateWelcomePopupInput = {
  name: string;
  template: WelcomePopupTemplate;
  heading: string;
  description?: string | null | undefined;
  offerLabel?: string | null | undefined;
  couponId?: number | null | undefined;
  ctaMode?: WelcomePopupCtaMode | undefined;
  ctaLabel?: string | undefined;
  ctaUrl?: string | null | undefined;
  displayDelayMs?: number | undefined;
  dismissalCooldownDays?: number | undefined;
  consentText?: string | null | undefined;
  dismissLabel?: string | null | undefined;
  desktopImageId?: number | null | undefined;
  desktopImageAlt?: string | null | undefined;
  mobileImageId?: number | null | undefined;
  mobileImageAlt?: string | null | undefined;
};

export type UpdateWelcomePopupInput = {
  name?: string | undefined;
  template?: WelcomePopupTemplate | undefined;
  heading?: string | undefined;
  description?: string | null | undefined;
  offerLabel?: string | null | undefined;
  couponId?: number | null | undefined;
  ctaMode?: WelcomePopupCtaMode | undefined;
  ctaLabel?: string | undefined;
  ctaUrl?: string | null | undefined;
  displayDelayMs?: number | undefined;
  dismissalCooldownDays?: number | undefined;
  consentText?: string | null | undefined;
  dismissLabel?: string | null | undefined;
  desktopImageId?: number | null | undefined;
  desktopImageAlt?: string | null | undefined;
  mobileImageId?: number | null | undefined;
  mobileImageAlt?: string | null | undefined;
};

export type ListAdminWelcomePopupsQuery = {
  status?: WelcomePopupStatus | undefined;
};

export type WelcomePopupCouponOption = { id: number; code: string; name: string };
