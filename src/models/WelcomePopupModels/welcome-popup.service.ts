import { UniqueConstraintError, type Transaction } from "sequelize";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Coupon, MediaAsset, WelcomePopup } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import {
  WelcomePopupActivationConflictError,
  InvalidWelcomePopupDataError,
  WelcomePopupMediaNotFoundError,
  WelcomePopupMediaNotImageError,
  WelcomePopupNotFoundError,
  WelcomePopupNotPublishedError,
  WelcomePopupNotReadyToPublishError
} from "./welcome-popup.errors.js";
import type {
  AdminWelcomePopupItem,
  CreateWelcomePopupInput,
  ListAdminWelcomePopupsQuery,
  StorefrontWelcomePopup,
  UpdateWelcomePopupInput,
  WelcomePopupCouponOption
} from "./welcome-popup.types.js";

type ResolvedImageRef = { key: string | null; url: string | null; alt: string | null };

async function resolveCoupon(couponId: number | null | undefined): Promise<Coupon | null | undefined> {
  if (couponId === undefined) return undefined;
  if (couponId === null) return null;
  const coupon = await Coupon.findByPk(couponId);
  if (!coupon) throw new InvalidWelcomePopupDataError("Selected coupon was not found.");
  return coupon;
}

async function couponCodeFor(popup: WelcomePopup): Promise<string | null> {
  if (popup.coupon_id === null) return null;
  return (await Coupon.findByPk(popup.coupon_id))?.code ?? null;
}

// Never trusts a client-supplied URL for the stored image — the storage key
// and public URL are always read back from a verified, existing MediaAsset
// row. `mediaId === null` explicitly clears the field; `mediaId === undefined`
// means "leave this field untouched" (the caller distinguishes the two).
async function resolveImageRef(mediaId: number | null | undefined, altOverride: string | null | undefined, field: "desktop" | "mobile"): Promise<ResolvedImageRef | undefined> {
  if (mediaId === undefined) return undefined;
  if (mediaId === null) return { key: null, url: null, alt: null };

  const asset = await MediaAsset.findByPk(mediaId);
  if (!asset) {
    throw new WelcomePopupMediaNotFoundError(field);
  }
  if (asset.media_type !== "image") {
    throw new WelcomePopupMediaNotImageError(field);
  }

  return {
    key: asset.storage_key,
    url: asset.public_url,
    alt: altOverride !== undefined ? altOverride : (asset.alt_text ?? null)
  };
}

function assertPublishReady(popup: WelcomePopup): void {
  if (!popup.desktop_image_url) {
    throw new WelcomePopupNotReadyToPublishError("A desktop image is required before this popup can be published.");
  }
  if (!popup.description?.trim()) {
    throw new WelcomePopupNotReadyToPublishError("A description is required before this popup can be published.");
  }
  if (popup.template === "template_2" && !popup.offer_label) {
    throw new WelcomePopupNotReadyToPublishError("Template 2 requires an offer label (e.g. \"15% OFF\") before it can be published.");
  }
}

function assertNavigationUrl(popup: Pick<WelcomePopup, "cta_mode" | "cta_url">): void {
  if (popup.cta_mode === "navigation" && !popup.cta_url) {
    throw new InvalidWelcomePopupDataError("CTA URL is required for navigation.");
  }
}

export class WelcomePopupService {
  public static async listCouponOptions(): Promise<WelcomePopupCouponOption[]> {
    const coupons = await Coupon.findAll({ where: { status: "active" }, order: [["code", "ASC"]] });
    return coupons.map(({ id, code, name }) => ({ id, code, name }));
  }

  public static toAdminItem(popup: WelcomePopup, couponCode: string | null = null): AdminWelcomePopupItem {
    return {
      id: popup.id,
      name: popup.name,
      template: popup.template,
      status: popup.status,
      isHomepageActive: popup.is_homepage_active,
      heading: popup.heading,
      description: popup.description,
      offerLabel: popup.offer_label,
      couponId: popup.coupon_id,
      couponCode,
      ctaMode: popup.cta_mode,
      ctaLabel: popup.cta_label,
      ctaUrl: popup.cta_url,
      displayDelayMs: popup.display_delay_ms,
      dismissalCooldownDays: popup.dismissal_cooldown_days,
      consentText: popup.consent_text,
      dismissLabel: popup.dismiss_label,
      desktopImageUrl: popup.desktop_image_url,
      desktopImageAlt: popup.desktop_image_alt,
      mobileImageUrl: popup.mobile_image_url,
      mobileImageAlt: popup.mobile_image_alt,
      createdAt: popup.created_at ? popup.created_at.toISOString() : new Date().toISOString(),
      updatedAt: popup.updated_at ? popup.updated_at.toISOString() : new Date().toISOString()
    };
  }

  public static toStorefrontItem(popup: WelcomePopup, couponCode: string | null = null): StorefrontWelcomePopup {
    return {
      id: popup.id,
      template: popup.template,
      heading: popup.heading,
      description: popup.description,
      offerLabel: popup.offer_label,
      couponCode,
      ctaMode: popup.cta_mode,
      ctaLabel: popup.cta_label,
      ctaUrl: popup.cta_url,
      displayDelayMs: popup.display_delay_ms,
      dismissalCooldownDays: popup.dismissal_cooldown_days,
      consentText: popup.consent_text,
      dismissLabel: popup.dismiss_label,
      desktopImageUrl: popup.desktop_image_url,
      desktopImageAlt: popup.desktop_image_alt,
      mobileImageUrl: popup.mobile_image_url,
      mobileImageAlt: popup.mobile_image_alt
    };
  }

  /**
   * The one popup a visitor should see, or null. Checks both status and
   * is_homepage_active explicitly (defense in depth) even though the
   * database's own CHECK constraint already guarantees an active popup is
   * always published — this method must never expose a draft, regardless.
   */
  public static async getStorefrontActivePopup(): Promise<StorefrontWelcomePopup | null> {
    const popup = await WelcomePopup.findOne({ where: { status: "published", is_homepage_active: true } });
    return popup ? this.toStorefrontItem(popup, await couponCodeFor(popup)) : null;
  }

  public static async listAdminItems(query: ListAdminWelcomePopupsQuery): Promise<AdminWelcomePopupItem[]> {
    const where: Record<string, unknown> = {};
    if (query.status) {
      where.status = query.status;
    }

    const popups = await WelcomePopup.findAll({
      where,
      order: [
        ["updated_at", "DESC"],
        ["id", "DESC"]
      ]
    });

    return Promise.all(popups.map(async (popup) => this.toAdminItem(popup, await couponCodeFor(popup))));
  }

  public static async getAdminItemById(id: number): Promise<AdminWelcomePopupItem> {
    const popup = await WelcomePopup.findByPk(id);
    if (!popup) {
      throw new WelcomePopupNotFoundError();
    }
    return this.toAdminItem(popup, await couponCodeFor(popup));
  }

  public static async createItem(input: CreateWelcomePopupInput): Promise<AdminWelcomePopupItem> {
    const desktop = await resolveImageRef(input.desktopImageId, input.desktopImageAlt, "desktop");
    const mobile = await resolveImageRef(input.mobileImageId, input.mobileImageAlt, "mobile");
    const coupon = await resolveCoupon(input.couponId);

    return sequelize.transaction(async (transaction) => {
      const allocatedId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.welcomePopups, transaction);

      const popup = await WelcomePopup.create(
        {
          id: allocatedId,
          name: input.name,
          template: input.template,
          heading: input.heading,
          description: input.description ?? null,
          offer_label: input.offerLabel ?? null,
          coupon_id: coupon?.id ?? null,
          cta_mode: input.ctaMode ?? "email_signup",
          ...(input.ctaLabel !== undefined ? { cta_label: input.ctaLabel } : {}),
          cta_url: input.ctaUrl ?? null,
          display_delay_ms: input.displayDelayMs ?? 1200,
          dismissal_cooldown_days: input.dismissalCooldownDays ?? 7,
          consent_text: input.consentText ?? null,
          dismiss_label: input.dismissLabel ?? null,
          desktop_image_key: desktop?.key ?? null,
          desktop_image_url: desktop?.url ?? null,
          desktop_image_alt: desktop?.alt ?? null,
          mobile_image_key: mobile?.key ?? null,
          mobile_image_url: mobile?.url ?? null,
          mobile_image_alt: mobile?.alt ?? null
        },
        { transaction }
      );

      assertNavigationUrl(popup);
      return this.toAdminItem(popup, coupon?.code ?? null);
    });
  }

  public static async updateItem(id: number, input: UpdateWelcomePopupInput): Promise<AdminWelcomePopupItem> {
    const popup = await WelcomePopup.findByPk(id);
    if (!popup) {
      throw new WelcomePopupNotFoundError();
    }

    const desktop = await resolveImageRef(input.desktopImageId, input.desktopImageAlt, "desktop");
    const mobile = await resolveImageRef(input.mobileImageId, input.mobileImageAlt, "mobile");
    const coupon = await resolveCoupon(input.couponId);

    if (input.name !== undefined) popup.name = input.name;
    if (input.template !== undefined) popup.template = input.template;
    if (input.heading !== undefined) popup.heading = input.heading;
    if (input.description !== undefined) popup.description = input.description;
    if (input.offerLabel !== undefined) popup.offer_label = input.offerLabel;
    if (coupon !== undefined) popup.coupon_id = coupon?.id ?? null;
    if (input.ctaMode !== undefined) popup.cta_mode = input.ctaMode;
    if (input.ctaLabel !== undefined) popup.cta_label = input.ctaLabel;
    if (input.ctaUrl !== undefined) popup.cta_url = input.ctaUrl;
    if (input.displayDelayMs !== undefined) popup.display_delay_ms = input.displayDelayMs;
    if (input.dismissalCooldownDays !== undefined) popup.dismissal_cooldown_days = input.dismissalCooldownDays;
    if (input.consentText !== undefined) popup.consent_text = input.consentText;
    if (input.dismissLabel !== undefined) popup.dismiss_label = input.dismissLabel;
    if (desktop !== undefined) {
      popup.desktop_image_key = desktop.key;
      popup.desktop_image_url = desktop.url;
      popup.desktop_image_alt = desktop.alt;
    }
    if (mobile !== undefined) {
      popup.mobile_image_key = mobile.key;
      popup.mobile_image_url = mobile.url;
      popup.mobile_image_alt = mobile.alt;
    }

    assertNavigationUrl(popup);
    await popup.save();
    return this.toAdminItem(popup, await couponCodeFor(popup));
  }

  public static async publishItem(id: number): Promise<AdminWelcomePopupItem> {
    const popup = await WelcomePopup.findByPk(id);
    if (!popup) {
      throw new WelcomePopupNotFoundError();
    }

    assertPublishReady(popup);
    popup.status = "published";
    await popup.save();
    return this.toAdminItem(popup, await couponCodeFor(popup));
  }

  /**
   * Atomically replaces the homepage assignment: locks the target row,
   * requires it to already be published, clears any other currently-active
   * popup, then activates this one — all inside one transaction, so a
   * failure at any step (not found, not published, or a racing activation
   * losing the database's own single-active unique constraint) rolls the
   * whole thing back and the previously active popup is left untouched.
   */
  public static async activateItem(id: number): Promise<AdminWelcomePopupItem> {
    try {
      return await sequelize.transaction(async (transaction: Transaction) => {
        const popup = await WelcomePopup.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!popup) {
          throw new WelcomePopupNotFoundError();
        }
        if (popup.status !== "published") {
          throw new WelcomePopupNotPublishedError();
        }

        if (!popup.is_homepage_active) {
          await WelcomePopup.update(
            { is_homepage_active: false },
            { where: { is_homepage_active: true }, transaction }
          );
          popup.is_homepage_active = true;
          await popup.save({ transaction });
        }

        return this.toAdminItem(popup, await couponCodeFor(popup));
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new WelcomePopupActivationConflictError();
      }
      throw error;
    }
  }

  public static async deactivateItem(id: number): Promise<AdminWelcomePopupItem> {
    const popup = await WelcomePopup.findByPk(id);
    if (!popup) {
      throw new WelcomePopupNotFoundError();
    }

    popup.is_homepage_active = false;
    await popup.save();
    return this.toAdminItem(popup, await couponCodeFor(popup));
  }

  public static async archiveItem(id: number): Promise<AdminWelcomePopupItem> {
    const popup = await WelcomePopup.findByPk(id);
    if (!popup) {
      throw new WelcomePopupNotFoundError();
    }

    popup.status = "archived";
    popup.is_homepage_active = false;
    await popup.save();
    return this.toAdminItem(popup, await couponCodeFor(popup));
  }

  /**
   * Clones a popup's content into a brand-new draft — never active, never
   * carrying the original's publish state — so an admin can safely
   * experiment from a working design without touching what is currently live.
   */
  public static async duplicateItem(id: number): Promise<AdminWelcomePopupItem> {
    const source = await WelcomePopup.findByPk(id);
    if (!source) {
      throw new WelcomePopupNotFoundError();
    }

    return sequelize.transaction(async (transaction) => {
      const allocatedId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.welcomePopups, transaction);

      const copy = await WelcomePopup.create(
        {
          id: allocatedId,
          name: `${source.name} (Copy)`,
          template: source.template,
          status: "draft",
          is_homepage_active: false,
          heading: source.heading,
          description: source.description,
          offer_label: source.offer_label,
          coupon_id: source.coupon_id,
          cta_mode: source.cta_mode,
          cta_label: source.cta_label,
          cta_url: source.cta_url,
          display_delay_ms: source.display_delay_ms,
          dismissal_cooldown_days: source.dismissal_cooldown_days,
          consent_text: source.consent_text,
          dismiss_label: source.dismiss_label,
          desktop_image_key: source.desktop_image_key,
          desktop_image_url: source.desktop_image_url,
          desktop_image_alt: source.desktop_image_alt,
          mobile_image_key: source.mobile_image_key,
          mobile_image_url: source.mobile_image_url,
          mobile_image_alt: source.mobile_image_alt
        },
        { transaction }
      );

      return this.toAdminItem(copy, await couponCodeFor(copy));
    });
  }
}
