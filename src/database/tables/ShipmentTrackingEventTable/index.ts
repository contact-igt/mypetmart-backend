import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, SHIPMENT_STATUS_VALUES, type ShipmentStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Shipment } from "../ShipmentTable/index.js";

export class ShipmentTrackingEvent extends Model<InferAttributes<ShipmentTrackingEvent>, InferCreationAttributes<ShipmentTrackingEvent>> {
  declare id: CreationOptional<number>;
  declare shipment_id: ForeignKey<Shipment["id"]>;
  declare dedupe_key: string;
  declare provider_status: string;
  declare provider_status_code: string | null;
  declare normalized_status: ShipmentStatus;
  declare location: string | null;
  declare message: string | null;
  declare event_at: Date;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare shipment?: NonAttribute<Shipment>;
}

export function initializeShipmentTrackingEventTable(sequelize: Sequelize): typeof ShipmentTrackingEvent {
  if (isModelInitialized(ShipmentTrackingEvent)) return ShipmentTrackingEvent;
  ShipmentTrackingEvent.init(
    {
      id: numericPrimaryKeyAttribute(),
      shipment_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      dedupe_key: { type: DataTypes.CHAR(64), allowNull: false },
      provider_status: { type: DataTypes.STRING(120), allowNull: false },
      provider_status_code: { type: DataTypes.STRING(80), allowNull: true },
      normalized_status: { type: DataTypes.ENUM(...SHIPMENT_STATUS_VALUES), allowNull: false },
      location: { type: DataTypes.STRING(255), allowNull: true },
      message: { type: DataTypes.STRING(1000), allowNull: true },
      event_at: { type: DataTypes.DATE, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.shipmentTrackingEvents, "ShipmentTrackingEvent", false),
      indexes: [
        { unique: true, fields: ["shipment_id", "dedupe_key"], name: "shipment_events_dedupe_unique" },
        { fields: ["shipment_id", "event_at"], name: "shipment_events_timeline_idx" }
      ]
    }
  );
  return ShipmentTrackingEvent;
}
