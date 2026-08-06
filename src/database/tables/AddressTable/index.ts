import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_COUNTRY_CODE } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, uuidPrimaryKeyAttribute } from "../table-helpers.js";
import type { User } from "../UserTable/index.js";

export class Address extends Model<InferAttributes<Address>, InferCreationAttributes<Address>> {
  declare id: CreationOptional<string>;
  declare user_id: ForeignKey<User["id"]>;
  declare label: string | null;
  declare recipient_name: string;
  declare phone: string;
  declare line_1: string;
  declare line_2: string | null;
  declare city: string;
  declare state: string;
  declare postal_code: string;
  declare country: CreationOptional<string>;
  declare is_default: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare user?: NonAttribute<User>;
}

export function initializeAddressTable(sequelize: Sequelize): typeof Address {
  if (isModelInitialized(Address)) {
    return Address;
  }

  Address.init(
    {
      id: uuidPrimaryKeyAttribute(),
      user_id: { type: DataTypes.UUID, allowNull: false },
      label: { type: DataTypes.STRING(80), allowNull: true, validate: { len: [0, 80] } },
      recipient_name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      phone: { type: DataTypes.STRING(32), allowNull: false, validate: { notEmpty: true, len: [1, 32] } },
      line_1: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true, len: [1, 255] } },
      line_2: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
      city: { type: DataTypes.STRING(120), allowNull: false, validate: { notEmpty: true, len: [1, 120] } },
      state: { type: DataTypes.STRING(120), allowNull: false, validate: { notEmpty: true, len: [1, 120] } },
      postal_code: { type: DataTypes.STRING(20), allowNull: false, validate: { notEmpty: true, len: [1, 20] } },
      country: { type: DataTypes.STRING(2), allowNull: false, defaultValue: DEFAULT_COUNTRY_CODE, validate: { len: [2, 2] } },
      is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      deleted_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.addresses, "Address", true),
      indexes: [
        { fields: ["user_id"], name: "addresses_user_id_idx" },
        { fields: ["user_id", "is_default"], name: "addresses_user_default_idx" },
        { fields: ["city", "state"], name: "addresses_city_state_idx" },
        { fields: ["postal_code"], name: "addresses_postal_code_idx" },
        { fields: ["deleted_at"], name: "addresses_deleted_at_idx" }
      ]
    }
  );

  return Address;
}