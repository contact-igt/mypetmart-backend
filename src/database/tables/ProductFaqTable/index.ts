import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Product } from "../ProductTable/index.js";

export class ProductFaq extends Model<InferAttributes<ProductFaq>, InferCreationAttributes<ProductFaq>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare question: string;
  declare answer: string;
  declare display_order: CreationOptional<number>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare product?: NonAttribute<Product>;
}

export function initializeProductFaqTable(sequelize: Sequelize): typeof ProductFaq {
  if (isModelInitialized(ProductFaq)) {
    return ProductFaq;
  }

  ProductFaq.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      question: { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: true, len: [1, 200] } },
      answer: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productFaqs, "ProductFaq", false),
      indexes: [{ fields: ["product_id", "display_order"], name: "product_faqs_product_order_idx" }]
    }
  );

  return ProductFaq;
}
