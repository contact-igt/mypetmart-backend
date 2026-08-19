import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { User } from "../UserTable/index.js";

export class MediaAsset extends Model<InferAttributes<MediaAsset>, InferCreationAttributes<MediaAsset>> {
  declare id: CreationOptional<number>;
  declare file_name: string;
  declare original_name: string;
  declare storage_key: string;
  declare public_url: string;
  declare mime_type: string;
  declare file_size: number;
  declare width: number | null;
  declare height: number | null;
  declare alt_text: string | null;
  declare title: string | null;
  declare uploaded_by: ForeignKey<User["id"]>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare uploadedBy?: NonAttribute<User>;
}

export function initializeMediaAssetTable(sequelize: Sequelize): typeof MediaAsset {
  if (isModelInitialized(MediaAsset)) {
    return MediaAsset;
  }

  MediaAsset.init(
    {
      id: numericPrimaryKeyAttribute(),
      file_name: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true, len: [1, 255] } },
      original_name: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true, len: [1, 255] } },
      storage_key: { type: DataTypes.STRING(512), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 512] } },
      public_url: { type: DataTypes.STRING(1000), allowNull: false, validate: { notEmpty: true, len: [1, 1000], isUrl: true } },
      mime_type: { type: DataTypes.STRING(100), allowNull: false, validate: { notEmpty: true, len: [1, 100] } },
      file_size: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 0 } },
      width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 0 } },
      height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 0 } },
      alt_text: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
      title: { type: DataTypes.STRING(190), allowNull: true, validate: { len: [0, 190] } },
      uploaded_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      deleted_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.mediaAssets, "MediaAsset", true),
      indexes: [
        { unique: true, fields: ["storage_key"], name: "media_assets_storage_key_unique" },
        { fields: ["uploaded_by"], name: "media_assets_uploaded_by_idx" },
        { fields: ["created_at"], name: "media_assets_created_at_idx" },
        { fields: ["deleted_at"], name: "media_assets_deleted_at_idx" }
      ]
    }
  );

  return MediaAsset;
}
