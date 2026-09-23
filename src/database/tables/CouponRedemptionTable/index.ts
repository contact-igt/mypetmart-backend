import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { COUPON_DISCOUNT_TYPE_VALUES, COUPON_REDEMPTION_STATUS_VALUES, DATABASE_TABLE_NAMES, type CouponDiscountType, type CouponRedemptionStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Coupon } from "../CouponTable/index.js";
import type { Order } from "../OrderTable/index.js";
import type { User } from "../UserTable/index.js";

// One immutable row per order that reserved a coupon (Module 2 creates these
// inside the same transaction as order creation — not yet wired up here).
// Never updated except its `status`/`*_at` transition columns; every
// financial value is a snapshot, so a later coupon edit or deletion can
// never change what an already-placed order is explained to have received.
// UNIQUE(order_id) is the "one coupon per order" rule at the database level.
export class CouponRedemption extends Model<InferAttributes<CouponRedemption>, InferCreationAttributes<CouponRedemption>> {
  declare id: CreationOptional<number>;
  declare coupon_id: ForeignKey<Coupon["id"]>;
  declare order_id: ForeignKey<Order["id"]>;
  // Null for a guest order — guests are never subject to per-customer/
  // first-order limits (V1 rule), so this column exists for audit/reporting
  // only, never for enforcement, when null.
  declare user_id: ForeignKey<User["id"]> | null;
  declare guest_identity_hash: string | null;
  declare code_snapshot: string;
  declare discount_type_snapshot: CouponDiscountType;
  declare discount_value_snapshot: number;
  declare eligible_merchandise_paise: number;
  declare discount_amount_paise: number;
  declare status: CreationOptional<CouponRedemptionStatus>;
  declare reserved_at: CreationOptional<Date>;
  declare consumed_at: Date | null;
  declare released_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare coupon?: NonAttribute<Coupon>;
  declare order?: NonAttribute<Order>;
  declare user?: NonAttribute<User>;
}

export function initializeCouponRedemptionTable(sequelize: Sequelize): typeof CouponRedemption {
  if (isModelInitialized(CouponRedemption)) {
    return CouponRedemption;
  }

  CouponRedemption.init(
    {
      id: numericPrimaryKeyAttribute(),
      coupon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      guest_identity_hash: { type: DataTypes.STRING(64), allowNull: true },
      code_snapshot: { type: DataTypes.STRING(40), allowNull: false },
      discount_type_snapshot: { type: DataTypes.ENUM(...COUPON_DISCOUNT_TYPE_VALUES), allowNull: false },
      discount_value_snapshot: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      eligible_merchandise_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      discount_amount_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.ENUM(...COUPON_REDEMPTION_STATUS_VALUES), allowNull: false, defaultValue: "reserved" },
      reserved_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      released_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.couponRedemptions, "CouponRedemption", false),
      indexes: [
        { unique: true, fields: ["order_id"], name: "coupon_redemptions_order_id_unique" },
        { fields: ["coupon_id", "status"], name: "coupon_redemptions_coupon_status_idx" },
        { fields: ["coupon_id", "user_id", "status"], name: "coupon_redemptions_coupon_user_status_idx" }
      ]
    }
  );

  return CouponRedemption;
}
