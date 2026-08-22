import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Product } from "../ProductTable/index.js";

export class ProductFeature extends Model<InferAttributes<ProductFeature>, InferCreationAttributes<ProductFeature>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare label: string;
  declare display_order: CreationOptional<number>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare product?: NonAttribute<Product>;
}

export function initializeProductFeatureTable(sequelize: Sequelize): typeof ProductFeature {
  if (isModelInitialized(ProductFeature)) {
    return ProductFeature;
  }

  ProductFeature.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      label: { type: DataTypes.STRING(120), allowNull: false, validate: { notEmpty: true, len: [1, 120] } },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productFeatures, "ProductFeature", false),
      indexes: [{ fields: ["product_id", "display_order"], name: "product_features_product_order_idx" }]
    }
  );

  return ProductFeature;
}
