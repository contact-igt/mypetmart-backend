import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, MONEY_PRECISION, MONEY_SCALE, PET_TYPE_VALUES, PRODUCT_STATUS_VALUES, type PetType, type ProductStatus } from "../../../constants/database.constants.js";
import { assertNullableCompareAtPrice, isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { CartItem } from "../CartItemTable/index.js";
import type { Category } from "../CategoryTable/index.js";
import type { OrderItem } from "../OrderItemTable/index.js";
import type { ProductImage } from "../ProductImageTable/index.js";
import type { ProductVariant } from "../ProductVariantTable/index.js";

export class Product extends Model<InferAttributes<Product>, InferCreationAttributes<Product>> {
  declare id: CreationOptional<number>;
  declare category_id: ForeignKey<Category["id"]>;
  declare name: string;
  declare slug: string;
  declare sku: string;
  declare brand: string | null;
  declare description: string;
  declare pet_type: CreationOptional<PetType>;
  declare status: CreationOptional<ProductStatus>;
  declare price: string;
  declare compare_at_price: string | null;
  declare stock: CreationOptional<number>;
  declare has_variants: CreationOptional<boolean>;
  declare featured: CreationOptional<boolean>;
  declare tags: unknown[] | null;
  declare meta_title: string | null;
  declare meta_description: string | null;
  declare weight_grams: number | null;
  declare length_cm: string | null;
  declare width_cm: string | null;
  declare height_cm: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare category?: NonAttribute<Category>;
  declare variants?: NonAttribute<ProductVariant[]>;
  declare images?: NonAttribute<ProductImage[]>;
  declare cartItems?: NonAttribute<CartItem[]>;
  declare orderItems?: NonAttribute<OrderItem[]>;
}

export function initializeProductTable(sequelize: Sequelize): typeof Product {
  if (isModelInitialized(Product)) {
    return Product;
  }

  Product.init(
    {
      id: numericPrimaryKeyAttribute(),
      category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      name: { type: DataTypes.STRING(190), allowNull: false, validate: { notEmpty: true, len: [1, 190] } },
      slug: { type: DataTypes.STRING(190), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 190] } },
      sku: { type: DataTypes.STRING(100), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 100] } },
      brand: { type: DataTypes.STRING(120), allowNull: true, validate: { len: [0, 120] } },
      description: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      pet_type: { type: DataTypes.ENUM(...PET_TYPE_VALUES), allowNull: false, defaultValue: "all" },
      status: { type: DataTypes.ENUM(...PRODUCT_STATUS_VALUES), allowNull: false, defaultValue: "draft" },
      price: {
        type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE),
        allowNull: false,
        validate: {
          isNonNegative(value: string) {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
              throw new Error("Product price must be non-negative.");
            }
          }
        }
      },
      compare_at_price: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: true },
      stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      has_variants: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      tags: { type: DataTypes.JSON, allowNull: true },
      meta_title: { type: DataTypes.STRING(190), allowNull: true, validate: { len: [0, 190] } },
      meta_description: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
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
      ...timestampModelOptions(DATABASE_TABLE_NAMES.products, "Product", true),
      validate: {
        compareAtPriceIsNotLowerThanPrice(this: Product) {
          assertNullableCompareAtPrice(this.compare_at_price, this.price);
        }
      },
      indexes: [
        { unique: true, fields: ["slug"], name: "products_slug_unique" },
        { unique: true, fields: ["sku"], name: "products_sku_unique" },
        { fields: ["category_id", "status"], name: "products_category_status_idx" },
        { fields: ["pet_type", "status"], name: "products_pet_type_status_idx" },
        { fields: ["featured", "status"], name: "products_featured_status_idx" },
        { fields: ["stock"], name: "products_stock_idx" },
        { fields: ["created_at"], name: "products_created_at_idx" },
        { fields: ["updated_at"], name: "products_updated_at_idx" },
        { fields: ["deleted_at"], name: "products_deleted_at_idx" }
      ]
    }
  );

  return Product;
}