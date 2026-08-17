import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";
import { AUTH_CHALLENGE_PURPOSE_VALUES, DATABASE_TABLE_NAMES, type AuthChallengePurpose } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { User } from "../UserTable/index.js";

export class AuthChallenge extends Model<InferAttributes<AuthChallenge>, InferCreationAttributes<AuthChallenge>> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare purpose: AuthChallengePurpose;
  declare code_hash: string;
  declare expires_at: Date;
  declare attempt_count: CreationOptional<number>;
  declare max_attempts: CreationOptional<number>;
  declare resend_available_at: Date;
  declare consumed_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare user?: NonAttribute<User>;
}

export function initializeAuthChallengeTable(sequelize: Sequelize): typeof AuthChallenge {
  if (isModelInitialized(AuthChallenge)) {
    return AuthChallenge;
  }

  AuthChallenge.init(
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
      purpose: {
        type: DataTypes.ENUM(...AUTH_CHALLENGE_PURPOSE_VALUES),
        allowNull: false
      },
      code_hash: {
        type: DataTypes.STRING(128),
        allowNull: false
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      attempt_count: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      max_attempts: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 5
      },
      resend_available_at: {
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
      ...timestampModelOptions(DATABASE_TABLE_NAMES.authChallenges, "AuthChallenge", false),
      indexes: [
        { fields: ["user_id", "purpose"], name: "auth_challenges_user_purpose_idx" },
        { fields: ["code_hash"], name: "auth_challenges_code_hash_idx" },
        { fields: ["expires_at"], name: "auth_challenges_expires_at_idx" }
      ]
    }
  );

  return AuthChallenge;
}
