import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { COUPON_DISCOUNT_TYPE_VALUES, COUPON_STATUS_VALUES, DATABASE_TABLE_NAMES, type CouponDiscountType, type CouponStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { CouponCategory } from "../CouponCategoryTable/index.js";
import type { CouponProduct } from "../CouponProductTable/index.js";
import type { CouponRedemption } from "../CouponRedemptionTable/index.js";

export class Coupon extends Model<InferAttributes<Coupon>, InferCreationAttributes<Coupon>> {
  declare id: CreationOptional<number>;
  // Always stored upper-cased/trimmed — see coupon.validation.ts's
  // normalizeCouponCode, the single place a raw customer/admin-typed code is
  // ever converted before touching this column.
  declare code: string;
  declare name: string;
  declare discount_type: CouponDiscountType;
  // Basis points (percentage) or integer paise (fixed) — see the constant's
  // doc comment in database.constants.ts.
  declare discount_value: number;
  declare max_discount_paise: number | null;
  declare min_eligible_amount_paise: CreationOptional<number>;
  declare starts_at: Date | null;
  declare ends_at: Date | null;
  declare usage_limit: number | null;
  declare per_customer_limit: number | null;
  declare first_order_only: CreationOptional<boolean>;
  declare status: CreationOptional<CouponStatus>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare eligibleProducts?: NonAttribute<CouponProduct[]>;
  declare eligibleCategories?: NonAttribute<CouponCategory[]>;
  declare redemptions?: NonAttribute<CouponRedemption[]>;
}

export function initializeCouponTable(sequelize: Sequelize): typeof Coupon {
  if (isModelInitialized(Coupon)) {
    return Coupon;
  }

  Coupon.init(
    {
      id: numericPrimaryKeyAttribute(),
      code: { type: DataTypes.STRING(40), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 40] } },
      name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      discount_type: { type: DataTypes.ENUM(...COUPON_DISCOUNT_TYPE_VALUES), allowNull: false },
      discount_value: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
      max_discount_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
      min_eligible_amount_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      starts_at: { type: DataTypes.DATE, allowNull: true },
      ends_at: { type: DataTypes.DATE, allowNull: true },
      usage_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
      per_customer_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
      first_order_only: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM(...COUPON_STATUS_VALUES), allowNull: false, defaultValue: "draft" },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.coupons, "Coupon", false),
      indexes: [
        { unique: true, fields: ["code"], name: "coupons_code_unique" },
        { fields: ["status"], name: "coupons_status_idx" }
      ]
    }
  );

  return Coupon;
}
