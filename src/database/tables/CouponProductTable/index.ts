import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Coupon } from "../CouponTable/index.js";
import type { Product } from "../ProductTable/index.js";

// Optional eligible-product allowlist for a coupon. No rows for a coupon
// means "no product restriction" — see CouponPricingService's eligibility
// check, which treats an empty allowlist (on both this table and
// CouponCategoryTable) as "all merchandise eligible."
export class CouponProduct extends Model<InferAttributes<CouponProduct>, InferCreationAttributes<CouponProduct>> {
  declare id: CreationOptional<number>;
  declare coupon_id: ForeignKey<Coupon["id"]>;
  declare product_id: ForeignKey<Product["id"]>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeCouponProductTable(sequelize: Sequelize): typeof CouponProduct {
  if (isModelInitialized(CouponProduct)) {
    return CouponProduct;
  }

  CouponProduct.init(
    {
      id: numericPrimaryKeyAttribute(),
      coupon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.couponProducts, "CouponProduct", false),
      indexes: [
        { unique: true, fields: ["coupon_id", "product_id"], name: "coupon_products_coupon_product_unique" },
        { fields: ["product_id"], name: "coupon_products_product_id_idx" }
      ]
    }
  );

  return CouponProduct;
}
