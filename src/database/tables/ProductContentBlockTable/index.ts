import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, PRODUCT_CONTENT_LAYOUT_VALUES, type ProductContentLayout } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { MediaAsset } from "../MediaAssetTable/index.js";
import type { Product } from "../ProductTable/index.js";

export class ProductContentBlock extends Model<InferAttributes<ProductContentBlock>, InferCreationAttributes<ProductContentBlock>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare media_asset_id: ForeignKey<MediaAsset["id"]> | null;
  declare heading: string | null;
  declare description: string | null;
  declare layout: CreationOptional<ProductContentLayout>;
  declare display_order: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare product?: NonAttribute<Product>;
  declare media?: NonAttribute<MediaAsset | null>;
}

export function initializeProductContentBlockTable(sequelize: Sequelize): typeof ProductContentBlock {
  if (isModelInitialized(ProductContentBlock)) {
    return ProductContentBlock;
  }

  ProductContentBlock.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      media_asset_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      heading: { type: DataTypes.STRING(160), allowNull: true, validate: { len: [0, 160] } },
      description: { type: DataTypes.TEXT, allowNull: true },
      layout: { type: DataTypes.ENUM(...PRODUCT_CONTENT_LAYOUT_VALUES), allowNull: false, defaultValue: "media_left" },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productContentBlocks, "ProductContentBlock", false),
      indexes: [
        { fields: ["product_id", "display_order"], name: "product_content_blocks_product_order_idx" },
        { fields: ["media_asset_id"], name: "product_content_blocks_media_asset_id_idx" }
      ]
    }
  );

  return ProductContentBlock;
}
