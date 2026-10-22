import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { BREEZE_ALERT_DELIVERY_VALUES, BREEZE_ALERT_KIND_VALUES, DATABASE_TABLE_NAMES, type BreezeAlertKind } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";

// One row per distinct operational condition (alert_key). Repeats increment
// occurrences instead of creating new rows, which is the alert-storm guard.
// detail holds non-sensitive identifiers and counts only — never customer data
// or credentials.
export class BreezeReconciliationAlert extends Model<InferAttributes<BreezeReconciliationAlert>, InferCreationAttributes<BreezeReconciliationAlert>> {
  declare id: CreationOptional<number>;
  declare alert_key: string;
  declare alert_kind: BreezeAlertKind;
  declare occurrences: CreationOptional<number>;
  declare first_seen_at: CreationOptional<Date>;
  declare last_seen_at: CreationOptional<Date>;
  declare delivery_status: CreationOptional<(typeof BREEZE_ALERT_DELIVERY_VALUES)[number]>;
  declare delivered_at: Date | null;
  declare detail: unknown;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeBreezeReconciliationAlertTable(sequelize: Sequelize): typeof BreezeReconciliationAlert {
  if (isModelInitialized(BreezeReconciliationAlert)) {
    return BreezeReconciliationAlert;
  }

  BreezeReconciliationAlert.init(
    {
      id: numericPrimaryKeyAttribute(),
      alert_key: { type: DataTypes.STRING(190), allowNull: false },
      alert_kind: { type: DataTypes.ENUM(...BREEZE_ALERT_KIND_VALUES), allowNull: false },
      occurrences: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      first_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      last_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      delivery_status: { type: DataTypes.ENUM(...BREEZE_ALERT_DELIVERY_VALUES), allowNull: false, defaultValue: "pending" },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      detail: { type: DataTypes.JSON, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.breezeReconciliationAlerts, "BreezeReconciliationAlert", false),
      indexes: [
        { unique: true, fields: ["alert_key"], name: "breeze_reconciliation_alerts_key_unique" },
        { fields: ["delivery_status"], name: "breeze_reconciliation_alerts_delivery_idx" }
      ]
    }
  );

  return BreezeReconciliationAlert;
}
