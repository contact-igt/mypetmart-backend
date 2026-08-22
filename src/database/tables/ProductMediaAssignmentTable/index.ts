import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, PRODUCT_MEDIA_ROLE_VALUES, type ProductMediaRole } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { MediaAsset } from "../MediaAssetTable/index.js";
import type { Product } from "../ProductTable/index.js";

export class ProductMediaAssignment extends Model<InferAttributes<ProductMediaAssignment>, InferCreationAttributes<ProductMediaAssignment>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare media_asset_id: ForeignKey<MediaAsset["id"]>;
  declare media_role: ProductMediaRole;
  declare title: string | null;
  declare caption: string | null;
  declare display_order: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare product?: NonAttribute<Product>;
  declare mediaAsset?: NonAttribute<MediaAsset>;
}

export function initializeProductMediaAssignmentTable(sequelize: Sequelize): typeof ProductMediaAssignment {
  if (isModelInitialized(ProductMediaAssignment)) {
    return ProductMediaAssignment;
  }

  ProductMediaAssignment.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      media_asset_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      media_role: { type: DataTypes.ENUM(...PRODUCT_MEDIA_ROLE_VALUES), allowNull: false },
      title: { type: DataTypes.STRING(190), allowNull: true, validate: { len: [0, 190] } },
      caption: { type: DataTypes.STRING(500), allowNull: true, validate: { len: [0, 500] } },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productMediaAssignments, "ProductMediaAssignment", false),
      indexes: [
        { fields: ["product_id", "media_role", "display_order"], name: "product_media_assignments_product_role_order_idx" },
        { fields: ["media_asset_id"], name: "product_media_assignments_media_asset_id_idx" }
      ]
    }
  );

  return ProductMediaAssignment;
}
