import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, SESSION_TYPE_VALUES, type SessionType } from "../../../constants/database.constants.js";
import { isModelInitialized, removeSensitiveFields, timestampModelOptions, numericPrimaryKeyAttribute, type SerializedModel } from "../table-helpers.js";
import type { User } from "../UserTable/index.js";

export class AuthSession extends Model<InferAttributes<AuthSession>, InferCreationAttributes<AuthSession>> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<User["id"]>;
  declare session_type: SessionType;
  declare token_hash: string;
  declare user_agent: string | null;
  declare ip_address: string | null;
  declare expires_at: Date;
  declare revoked_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare user?: NonAttribute<User>;

  override toJSON(): SerializedModel {
    return removeSensitiveFields(this, ["token_hash"]);
  }
}

export function initializeAuthSessionTable(sequelize: Sequelize): typeof AuthSession {
  if (isModelInitialized(AuthSession)) {
    return AuthSession;
  }

  AuthSession.init(
    {
      id: numericPrimaryKeyAttribute(),
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      session_type: { type: DataTypes.ENUM(...SESSION_TYPE_VALUES), allowNull: false },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 255] } },
      user_agent: { type: DataTypes.STRING(512), allowNull: true, validate: { len: [0, 512] } },
      ip_address: { type: DataTypes.STRING(64), allowNull: true, validate: { len: [0, 64] } },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.authSessions, "AuthSession", false),
      indexes: [
        { unique: true, fields: ["token_hash"], name: "auth_sessions_token_hash_unique" },
        { fields: ["user_id"], name: "auth_sessions_user_id_idx" },
        { fields: ["session_type"], name: "auth_sessions_session_type_idx" },
        { fields: ["expires_at"], name: "auth_sessions_expires_at_idx" },
        { fields: ["revoked_at"], name: "auth_sessions_revoked_at_idx" }
      ]
    }
  );

  return AuthSession;
}