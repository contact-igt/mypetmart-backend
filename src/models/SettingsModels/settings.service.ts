import { paymentConfig, r2Config, shippingConfig } from "../../config/index.js";
import { StoreSetting } from "../../database/tables/StoreSettingTable/index.js";
import { User } from "../../database/tables/UserTable/index.js";
import { toSafeUserJSON, type SafeUser } from "../AuthModels/auth.types.js";
import type { IntegrationsStatusJSON, StoreProfile } from "./settings.types.js";

const STORE_PROFILE_KEY = "store_profile";

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
    return value as Partial<StoreProfile>;
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
