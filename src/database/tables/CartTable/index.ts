import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { CART_STATUS_VALUES, DATABASE_TABLE_NAMES, type CartStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, removeSensitiveFields, timestampModelOptions, numericPrimaryKeyAttribute, type SerializedModel } from "../table-helpers.js";
import type { CartItem } from "../CartItemTable/index.js";
import type { User } from "../UserTable/index.js";

export class Cart extends Model<InferAttributes<Cart>, InferCreationAttributes<Cart>> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<User["id"]> | null;
  declare guest_token_hash: string | null;
  declare status: CreationOptional<CartStatus>;
  declare expires_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare user?: NonAttribute<User>;
  declare items?: NonAttribute<CartItem[]>;

  override toJSON(): SerializedModel {
    return removeSensitiveFields(this, ["guest_token_hash"]);
  }
}

export function initializeCartTable(sequelize: Sequelize): typeof Cart {
  if (isModelInitialized(Cart)) {
    return Cart;
  }

  Cart.init(
    {
      id: numericPrimaryKeyAttribute(),
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      guest_token_hash: { type: DataTypes.STRING(255), allowNull: true, unique: true, validate: { len: [0, 255] } },
      status: { type: DataTypes.ENUM(...CART_STATUS_VALUES), allowNull: false, defaultValue: "active" },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.carts, "Cart", false),
      indexes: [
        { unique: true, fields: ["guest_token_hash"], name: "carts_guest_token_hash_unique" },
        { fields: ["user_id", "status"], name: "carts_user_status_idx" },
        { fields: ["status", "expires_at"], name: "carts_status_expires_at_idx" }
      ]
    }
  );

  return Cart;
}