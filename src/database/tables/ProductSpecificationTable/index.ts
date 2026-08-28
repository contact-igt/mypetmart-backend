import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Product } from "../ProductTable/index.js";

export class ProductSpecification extends Model<InferAttributes<ProductSpecification>, InferCreationAttributes<ProductSpecification>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare label: string;
  declare value: string;
  declare display_order: CreationOptional<number>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare product?: NonAttribute<Product>;
}

export function initializeProductSpecificationTable(sequelize: Sequelize): typeof ProductSpecification {
  if (isModelInitialized(ProductSpecification)) {
    return ProductSpecification;
  }

  ProductSpecification.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      label: { type: DataTypes.STRING(80), allowNull: false, validate: { notEmpty: true, len: [1, 80] } },
      value: { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: true, len: [1, 200] } },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productSpecifications, "ProductSpecification", false),
      indexes: [{ fields: ["product_id", "display_order"], name: "product_specifications_product_order_idx" }]
    }
  );

  return ProductSpecification;
}
