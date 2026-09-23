import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Category } from "../CategoryTable/index.js";
import type { Coupon } from "../CouponTable/index.js";

// Optional eligible-category allowlist — see CouponProductTable's doc
// comment; a coupon may carry either or both allowlists, combined with OR
// (V1 rule: "Product/category restrictions: Product OR category").
export class CouponCategory extends Model<InferAttributes<CouponCategory>, InferCreationAttributes<CouponCategory>> {
  declare id: CreationOptional<number>;
  declare coupon_id: ForeignKey<Coupon["id"]>;
  declare category_id: ForeignKey<Category["id"]>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeCouponCategoryTable(sequelize: Sequelize): typeof CouponCategory {
  if (isModelInitialized(CouponCategory)) {
    return CouponCategory;
  }

  CouponCategory.init(
    {
      id: numericPrimaryKeyAttribute(),
      coupon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.couponCategories, "CouponCategory", false),
      indexes: [
        { unique: true, fields: ["coupon_id", "category_id"], name: "coupon_categories_coupon_category_unique" },
        { fields: ["category_id"], name: "coupon_categories_category_id_idx" }
      ]
    }
  );

  return CouponCategory;
}
