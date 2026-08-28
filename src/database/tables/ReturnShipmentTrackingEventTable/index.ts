import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, RETURN_SHIPMENT_STATUS_VALUES, type ReturnShipmentStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { ReturnShipment } from "../ReturnShipmentTable/index.js";

export class ReturnShipmentTrackingEvent extends Model<InferAttributes<ReturnShipmentTrackingEvent>, InferCreationAttributes<ReturnShipmentTrackingEvent>> {
  declare id: CreationOptional<number>;
  declare return_shipment_id: ForeignKey<ReturnShipment["id"]>;
  declare dedupe_key: string;
  declare provider_status: string;
  declare provider_status_code: string | null;
  declare normalized_status: ReturnShipmentStatus;
  declare location: string | null;
  declare message: string | null;
  declare event_at: Date;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare returnShipment?: NonAttribute<ReturnShipment>;
}

export function initializeReturnShipmentTrackingEventTable(sequelize: Sequelize): typeof ReturnShipmentTrackingEvent {
  if (isModelInitialized(ReturnShipmentTrackingEvent)) return ReturnShipmentTrackingEvent;
  ReturnShipmentTrackingEvent.init(
    {
      id: numericPrimaryKeyAttribute(),
      return_shipment_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      dedupe_key: { type: DataTypes.CHAR(64), allowNull: false },
      provider_status: { type: DataTypes.STRING(120), allowNull: false },
      provider_status_code: { type: DataTypes.STRING(80), allowNull: true },
      normalized_status: { type: DataTypes.ENUM(...RETURN_SHIPMENT_STATUS_VALUES), allowNull: false },
      location: { type: DataTypes.STRING(255), allowNull: true },
      message: { type: DataTypes.STRING(1000), allowNull: true },
      event_at: { type: DataTypes.DATE, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.returnShipmentTrackingEvents, "ReturnShipmentTrackingEvent", false),
      indexes: [
        { unique: true, fields: ["return_shipment_id", "dedupe_key"], name: "return_shipment_events_dedupe_unique" },
        { fields: ["return_shipment_id", "event_at"], name: "return_shipment_events_timeline_idx" }
      ]
    }
  );
  return ReturnShipmentTrackingEvent;
}
