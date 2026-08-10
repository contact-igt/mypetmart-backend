import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, USER_ROLE_VALUES, USER_STATUS_VALUES, type UserRole, type UserStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, removeSensitiveFields, timestampModelOptions, numericPrimaryKeyAttribute, type SerializedModel } from "../table-helpers.js";
import type { Address } from "../AddressTable/index.js";
import type { AuthSession } from "../AuthSessionTable/index.js";
import type { Cart } from "../CartTable/index.js";
import type { OrderNote } from "../OrderNoteTable/index.js";
import type { Order } from "../OrderTable/index.js";
import type { ReturnNote } from "../ReturnNoteTable/index.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare reference_code: CreationOptional<string>;
  declare role: CreationOptional<UserRole>;
  declare status: CreationOptional<UserStatus>;
  declare name: string;
  declare email: string;
  declare phone: string | null;
  declare password_hash: string;
  declare email_verified_at: Date | null;
  declare last_login_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare authSessions?: NonAttribute<AuthSession[]>;
  declare addresses?: NonAttribute<Address[]>;
  declare carts?: NonAttribute<Cart[]>;
  declare orders?: NonAttribute<Order[]>;
  declare returnRequests?: NonAttribute<ReturnRequest[]>;
  declare authoredOrderNotes?: NonAttribute<OrderNote[]>;
  declare authoredReturnNotes?: NonAttribute<ReturnNote[]>;

  override toJSON(): SerializedModel {
    return removeSensitiveFields(this, ["password_hash"]);
  }
}

export function initializeUserTable(sequelize: Sequelize): typeof User {
  if (isModelInitialized(User)) {
    return User;
  }

  User.init(
    {
      id: numericPrimaryKeyAttribute(),
      reference_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
      },
      role: {
        type: DataTypes.ENUM(...USER_ROLE_VALUES),
        allowNull: false,
        defaultValue: "customer"
      },
      status: {
        type: DataTypes.ENUM(...USER_STATUS_VALUES),
        allowNull: false,
        defaultValue: "active"
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 160] }
      },
      email: {
        type: DataTypes.STRING(190),
        allowNull: false,
        unique: true,
        validate: { isEmail: true, len: [3, 190] },
        set(value: string) {
          this.setDataValue("email", value.trim().toLowerCase());
        }
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
        validate: { len: [0, 32] }
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 255] }
      },
      email_verified_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      deleted_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.users, "User", true),
      indexes: [
        { unique: true, fields: ["email"], name: "users_email_unique" },
        { unique: true, fields: ["reference_code"], name: "users_reference_code_unique" },
        { fields: ["role"], name: "users_role_idx" },
        { fields: ["status"], name: "users_status_idx" },
        { fields: ["phone"], name: "users_phone_idx" },
        { fields: ["created_at"], name: "users_created_at_idx" },
        { fields: ["deleted_at"], name: "users_deleted_at_idx" }
      ]
    }
  );



  return User;
}