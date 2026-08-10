import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";

export class StoreSetting extends Model<InferAttributes<StoreSetting>, InferCreationAttributes<StoreSetting>> {
  declare id: CreationOptional<number>;
  declare setting_key: string;
  declare setting_value: unknown;
  declare is_public: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeStoreSettingTable(sequelize: Sequelize): typeof StoreSetting {
  if (isModelInitialized(StoreSetting)) {
    return StoreSetting;
  }

  StoreSetting.init(
    {
      id: numericPrimaryKeyAttribute(),
      setting_key: { type: DataTypes.STRING(120), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 120] } },
      setting_value: { type: DataTypes.JSON, allowNull: false },
      is_public: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.storeSettings, "StoreSetting", false),
      indexes: [
        { unique: true, fields: ["setting_key"], name: "store_settings_setting_key_unique" },
        { fields: ["is_public"], name: "store_settings_is_public_idx" }
      ]
    }
  );

  return StoreSetting;
}