import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, WELCOME_POPUP_CTA_MODE_VALUES, WELCOME_POPUP_STATUS_VALUES, WELCOME_POPUP_TEMPLATE_VALUES, type WelcomePopupCtaMode, type WelcomePopupStatus, type WelcomePopupTemplate } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";

// Module 1 scope only (see WELCOME_POPUP_REPOSITORY_AUDIT.md §H) — table and
// model, no service/controller/routes yet. Content fields are a flat union of
// both templates' fields (mirrors how Category/Product keep one flat table
// rather than per-type sub-tables); the admin form (a later module) is
// responsible for showing only the fields relevant to the selected template.
//
// `is_homepage_active` is intentionally separate from `status`: `status`
// alone tracks the publication lifecycle (draft/published/archived), so any
// number of drafts and any number of published-but-not-shown popups can
// coexist. Exactly one row may have `is_homepage_active = true` at a time —
// enforced at the database level by a generated-column unique index (see
// migration 072 / schema-definition.ts), the same technique already used for
// "one default address per user" (AddressTable's `default_user_id`). That
// generated column is deliberately NOT declared on this model, exactly as
// AddressTable never declares `default_user_id` — it exists purely for the
// database constraint and is never read or written through Sequelize.
export class WelcomePopup extends Model<InferAttributes<WelcomePopup>, InferCreationAttributes<WelcomePopup>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare template: WelcomePopupTemplate;
  declare status: CreationOptional<WelcomePopupStatus>;
  declare is_homepage_active: CreationOptional<boolean>;
  declare heading: string;
  declare description: string | null;
  declare offer_label: string | null;
  declare coupon_id: number | null;
  declare cta_mode: CreationOptional<WelcomePopupCtaMode>;
  declare cta_label: CreationOptional<string>;
  declare cta_url: string | null;
  declare display_delay_ms: CreationOptional<number>;
  declare dismissal_cooldown_days: CreationOptional<number>;
  declare consent_text: string | null;
  declare dismiss_label: string | null;
  declare desktop_image_key: string | null;
  declare desktop_image_url: string | null;
  declare desktop_image_alt: string | null;
  declare mobile_image_key: string | null;
  declare mobile_image_url: string | null;
  declare mobile_image_alt: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeWelcomePopupTable(sequelize: Sequelize): typeof WelcomePopup {
  if (isModelInitialized(WelcomePopup)) {
    return WelcomePopup;
  }

  WelcomePopup.init(
    {
      id: numericPrimaryKeyAttribute(),
      name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      template: { type: DataTypes.ENUM(...WELCOME_POPUP_TEMPLATE_VALUES), allowNull: false },
      status: { type: DataTypes.ENUM(...WELCOME_POPUP_STATUS_VALUES), allowNull: false, defaultValue: "draft" },
      is_homepage_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      heading: { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: true, len: [1, 200] } },
      description: { type: DataTypes.TEXT, allowNull: true },
      offer_label: { type: DataTypes.STRING(100), allowNull: true, validate: { len: [0, 100] } },
      coupon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      cta_mode: { type: DataTypes.ENUM(...WELCOME_POPUP_CTA_MODE_VALUES), allowNull: false, defaultValue: "email_signup" },
      cta_label: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "Subscribe", validate: { notEmpty: true, len: [1, 60] } },
      cta_url: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      display_delay_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1200, validate: { min: 0, max: 60_000 } },
      dismissal_cooldown_days: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 7, validate: { min: 0, max: 365 } },
      consent_text: { type: DataTypes.STRING(500), allowNull: true, validate: { len: [0, 500] } },
      dismiss_label: { type: DataTypes.STRING(60), allowNull: true, validate: { len: [0, 60] } },
      desktop_image_key: { type: DataTypes.STRING(512), allowNull: true, validate: { len: [0, 512] } },
      desktop_image_url: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      desktop_image_alt: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
      mobile_image_key: { type: DataTypes.STRING(512), allowNull: true, validate: { len: [0, 512] } },
      mobile_image_url: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      mobile_image_alt: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.welcomePopups, "WelcomePopup", false),
      indexes: [
        { fields: ["status"], name: "welcome_popups_status_idx" },
        { fields: ["is_homepage_active"], name: "welcome_popups_is_homepage_active_idx" }
      ]
    }
  );

  return WelcomePopup;
}
