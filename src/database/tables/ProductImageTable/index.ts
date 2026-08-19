import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { MediaAsset } from "../MediaAssetTable/index.js";
import type { Product } from "../ProductTable/index.js";

export class ProductImage extends Model<InferAttributes<ProductImage>, InferCreationAttributes<ProductImage>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare media_asset_id: ForeignKey<MediaAsset["id"]> | null;
  declare r2_key: string | null;
  declare url: string;
  declare alt: string;
  declare content_type: string;
  declare size_bytes: number | null;
  declare width: number | null;
  declare height: number | null;
  declare sort_order: CreationOptional<number>;
  declare is_primary: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare product?: NonAttribute<Product>;
  declare mediaAsset?: NonAttribute<MediaAsset>;
}

export function initializeProductImageTable(sequelize: Sequelize): typeof ProductImage {
  if (isModelInitialized(ProductImage)) {
    return ProductImage;
  }

  ProductImage.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      media_asset_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      r2_key: { type: DataTypes.STRING(512), allowNull: true, unique: true, validate: { len: [1, 512] } },
      url: { type: DataTypes.STRING(1000), allowNull: false, validate: { notEmpty: true, len: [1, 1000], isUrl: true } },
      alt: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true, len: [1, 255] } },
      content_type: { type: DataTypes.STRING(100), allowNull: false, validate: { notEmpty: true, len: [1, 100] } },
      size_bytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 0 } },
      width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 0 } },
      height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 0 } },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      deleted_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productImages, "ProductImage", true),
      indexes: [
        { unique: true, fields: ["r2_key"], name: "product_images_r2_key_unique" },
        { fields: ["product_id", "sort_order"], name: "product_images_product_sort_order_idx" },
        { fields: ["product_id", "is_primary"], name: "product_images_product_primary_idx" },
        { fields: ["media_asset_id"], name: "product_images_media_asset_id_idx" },
        { fields: ["deleted_at"], name: "product_images_deleted_at_idx" }
      ]
    }
  );

  return ProductImage;
}