import { QueryTypes, type Transaction } from "sequelize";

import { paymentConfig, r2Config, shippingConfig } from "../../config/index.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { StoreSetting } from "../../database/tables/StoreSettingTable/index.js";
import { User } from "../../database/tables/UserTable/index.js";
import { toSafeUserJSON, type SafeUser } from "../AuthModels/auth.types.js";
import { DISABLED_ONLINE_PAYMENT_DISCOUNT, type OnlinePaymentDiscountConfig } from "../CheckoutModels/online-payment-discount.js";
import type { IntegrationsStatusJSON, PayOnlineDiscountSettingsJSON, StoreProfile } from "./settings.types.js";
import { decimalStringToHundredths, type PayOnlineDiscountInput } from "./settings.validation.js";

const STORE_PROFILE_KEY = "store_profile";
const PAY_ONLINE_DISCOUNT_KEY = "pay_online_discount";

// Defensive read of the stored JSON: anything malformed is treated as
// "disabled" so a bad row can never produce a discount.
function parsePayOnlineDiscount(value: unknown): OnlinePaymentDiscountConfig {
  const raw = parseStoredProfile(value) as unknown as Record<string, unknown>;
  const discountType = raw.discountType === "fixed" ? "fixed" : raw.discountType === "percentage" ? "percentage" : null;
  const discountValue = typeof raw.discountValue === "number" && Number.isInteger(raw.discountValue) && raw.discountValue >= 0 ? raw.discountValue : null;
  if (discountType === null || discountValue === null) return DISABLED_ONLINE_PAYMENT_DISCOUNT;
  return { enabled: raw.enabled === true, discountType, discountValue };
}

// Basis points and paise are both hundredths of the admin-facing unit.
function hundredthsToDecimalString(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function toPayOnlineDiscountJSON(config: OnlinePaymentDiscountConfig, updatedAt: Date | null): PayOnlineDiscountSettingsJSON {
  return {
    enabled: config.enabled,
    discountType: config.discountType,
    discountValue: hundredthsToDecimalString(config.discountValue),
    updatedAt: updatedAt ? updatedAt.toISOString() : null
  };
}

// store_settings.id is not AUTO_INCREMENT. Reuse the id_sequences allocator,
// skipping past any id already present (rows seeded outside the allocator).
async function allocateStoreSettingId(transaction: Transaction): Promise<number> {
  const allocated = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.storeSettings, transaction);
  const rows = await sequelize.query<{ maxId: number | null }>("SELECT MAX(`id`) AS maxId FROM `store_settings`", { type: QueryTypes.SELECT, transaction });
  return Math.max(allocated, (rows[0]?.maxId ?? 0) + 1);
}

const DEFAULT_STORE_PROFILE: StoreProfile = {
  storeName: "My Pet Mart",
  supportEmail: "",
  supportPhone: "",
  address: ""
};

// This table's JSON column round-trips as a raw string rather than an
// auto-parsed object under this MySQL setup, so reads must parse it
// defensively instead of assuming Sequelize already did.
function parseStoredProfile(value: unknown): Partial<StoreProfile> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Partial<StoreProfile>;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object") {
    return value;
  }
  return {};
}

export const SettingsService = {
  async getStoreProfile(): Promise<StoreProfile> {
    const row = await StoreSetting.findOne({ where: { setting_key: STORE_PROFILE_KEY } });
    if (!row) return DEFAULT_STORE_PROFILE;
    return { ...DEFAULT_STORE_PROFILE, ...parseStoredProfile(row.setting_value) };
  },

  async updateStoreProfile(profile: StoreProfile): Promise<StoreProfile> {
    await StoreSetting.upsert({
      setting_key: STORE_PROFILE_KEY,
      setting_value: profile,
      is_public: true
    });
    return profile;
  },

  /** The live Global Pay Online Discount configuration used by pricing. */
  async getPayOnlineDiscountConfig(transaction?: Transaction): Promise<OnlinePaymentDiscountConfig> {
    const row = await StoreSetting.findOne({ where: { setting_key: PAY_ONLINE_DISCOUNT_KEY }, ...(transaction ? { transaction } : {}) });
    return row ? parsePayOnlineDiscount(row.setting_value) : DISABLED_ONLINE_PAYMENT_DISCOUNT;
  },

  async getPayOnlineDiscountSettings(): Promise<PayOnlineDiscountSettingsJSON> {
    const row = await StoreSetting.findOne({ where: { setting_key: PAY_ONLINE_DISCOUNT_KEY } });
    return toPayOnlineDiscountJSON(row ? parsePayOnlineDiscount(row.setting_value) : DISABLED_ONLINE_PAYMENT_DISCOUNT, row ? row.updated_at : null);
  },

  // Affects only future previews and Orders: every Order snapshots the
  // configuration it was priced with, so existing Orders never change.
  async updatePayOnlineDiscountSettings(input: PayOnlineDiscountInput): Promise<PayOnlineDiscountSettingsJSON> {
    const config: OnlinePaymentDiscountConfig = {
      enabled: input.enabled,
      discountType: input.discountType,
      discountValue: decimalStringToHundredths(input.discountValue)
    };
    const row = await sequelize.transaction(async (transaction) => {
      const existing = await StoreSetting.findOne({ where: { setting_key: PAY_ONLINE_DISCOUNT_KEY }, transaction, lock: transaction.LOCK.UPDATE });
      if (existing) {
        existing.setting_value = config;
        existing.changed("setting_value", true);
        return existing.save({ transaction });
      }
      const id = await allocateStoreSettingId(transaction);
      return StoreSetting.create({ id, setting_key: PAY_ONLINE_DISCOUNT_KEY, setting_value: config, is_public: false }, { transaction });
    });
    return toPayOnlineDiscountJSON(config, row.updated_at);
  },

  // Derived from the same validated environment config every integration
  // itself reads to decide whether it can actually run (paymentConfig.ready,
  // shippingConfig.ready, r2Config.ready) — never a second, independently
  // maintained guess at "is this connected". Analytics has no env schema
  // anywhere in this system (no Meta Pixel / GA / Clarity vars exist), so it
  // is always reported not-ready rather than fabricating a check.
  getIntegrationsStatus(): IntegrationsStatusJSON {
    return {
      paymentGateway: { provider: paymentConfig.provider ?? null, ready: paymentConfig.ready },
      shippingPartner: { provider: shippingConfig.provider ?? null, ready: shippingConfig.ready },
      imageStorage: { provider: "cloudflare_r2", ready: r2Config.ready },
      analytics: { provider: null, ready: false }
    };
  },

  async listAdminUsers(): Promise<SafeUser[]> {
    const rows = await User.findAll({
      where: { role: ["admin", "super_admin"] },
      order: [["created_at", "ASC"]]
    });
    return rows.map(toSafeUserJSON);
  }
};
