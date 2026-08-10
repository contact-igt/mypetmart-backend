import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, MONEY_PRECISION, MONEY_SCALE } from "../../../constants/database.constants.js";
import { assertNullableCompareAtPrice, isModelInitialized, isPositiveDecimal, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { CartItem } from "../CartItemTable/index.js";
import type { OrderItem } from "../OrderItemTable/index.js";
import type { Product } from "../ProductTable/index.js";

export class ProductVariant extends Model<InferAttributes<ProductVariant>, InferCreationAttributes<ProductVariant>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare name: string;
  declare sku: string;
  declare price: string;
  declare compare_at_price: string | null;
  declare stock: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare display_order: CreationOptional<number>;
  declare weight_grams: number | null;
  declare length_cm: string | null;
  declare width_cm: string | null;
  declare height_cm: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare product?: NonAttribute<Product>;
  declare cartItems?: NonAttribute<CartItem[]>;
  declare orderItems?: NonAttribute<OrderItem[]>;
}

export function initializeProductVariantTable(sequelize: Sequelize): typeof ProductVariant {
  if (isModelInitialized(ProductVariant)) {
    return ProductVariant;
  }

  ProductVariant.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      sku: { type: DataTypes.STRING(100), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 100] } },
      price: {
        type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE),
        allowNull: false,
        validate: {
          isPositive(value: string) {
            if (!isPositiveDecimal(value)) {
              throw new Error("Variant price must be positive.");
            }
          }
        }
      },
      compare_at_price: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: true },
      stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      weight_grams: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
      length_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: true, validate: { min: 0.01 } },
      width_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: true, validate: { min: 0.01 } },
      height_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: true, validate: { min: 0.01 } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      deleted_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productVariants, "ProductVariant", true),
      validate: {
        compareAtPriceIsNotLowerThanPrice(this: ProductVariant) {
          assertNullableCompareAtPrice(this.compare_at_price, this.price);
        }
      },
      indexes: [
        { unique: true, fields: ["sku"], name: "product_variants_sku_unique" },
        { fields: ["product_id", "active", "display_order"], name: "product_variants_product_active_order_idx" },
        { fields: ["stock"], name: "product_variants_stock_idx" },
        { fields: ["deleted_at"], name: "product_variants_deleted_at_idx" }
      ]
    }
  );

  return ProductVariant;
}