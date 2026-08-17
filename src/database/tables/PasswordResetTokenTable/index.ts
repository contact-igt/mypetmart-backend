import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";
import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { User } from "../UserTable/index.js";

export class PasswordResetToken extends Model<InferAttributes<PasswordResetToken>, InferCreationAttributes<PasswordResetToken>> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare token_hash: string;
  declare expires_at: Date;
  declare consumed_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare user?: NonAttribute<User>;
}

export function initializePasswordResetTokenTable(sequelize: Sequelize): typeof PasswordResetToken {
  if (isModelInitialized(PasswordResetToken)) {
    return PasswordResetToken;
  }

  PasswordResetToken.init(
    {
      id: numericPrimaryKeyAttribute(),
      user_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: DATABASE_TABLE_NAMES.users,
          key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      },
      token_hash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      consumed_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.passwordResetTokens, "PasswordResetToken", false),
      indexes: [
        { fields: ["user_id"], name: "password_reset_tokens_user_id_idx" },
        { unique: true, fields: ["token_hash"], name: "password_reset_tokens_token_hash_unique" },
        { fields: ["expires_at"], name: "password_reset_tokens_expires_at_idx" }
      ]
    }
  );

  return PasswordResetToken;
}
