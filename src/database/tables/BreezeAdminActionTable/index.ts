import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { BREEZE_ADMIN_ACTION_VALUES, DATABASE_TABLE_NAMES, type BreezeAdminAction } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";

// Append-only audit of staff reconciliation actions. Never updated or deleted.
export class BreezeAdminActionRecord extends Model<InferAttributes<BreezeAdminActionRecord>, InferCreationAttributes<BreezeAdminActionRecord>> {
  declare id: CreationOptional<number>;
  declare actor_user_id: number;
  declare action: BreezeAdminAction;
  declare target_type: string;
  declare target_id: number;
  declare reason: string;
  declare outcome_code: string;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeBreezeAdminActionTable(sequelize: Sequelize): typeof BreezeAdminActionRecord {
  if (isModelInitialized(BreezeAdminActionRecord)) {
    return BreezeAdminActionRecord;
  }

  BreezeAdminActionRecord.init(
    {
      id: numericPrimaryKeyAttribute(),
      actor_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      action: { type: DataTypes.ENUM(...BREEZE_ADMIN_ACTION_VALUES), allowNull: false },
      target_type: { type: DataTypes.STRING(40), allowNull: false },
      target_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: false },
      outcome_code: { type: DataTypes.STRING(80), allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.breezeAdminActions, "BreezeAdminActionRecord", false),
      indexes: [
        { fields: ["target_type", "target_id"], name: "breeze_admin_actions_target_idx" },
        { fields: ["actor_user_id"], name: "breeze_admin_actions_actor_idx" }
      ]
    }
  );

  return BreezeAdminActionRecord;
}
