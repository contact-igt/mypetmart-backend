import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, SHIPMENT_STATUS_VALUES, SHIPPING_METHOD_VALUES, type ShipmentStatus, type ShippingMethod } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, uuidPrimaryKeyAttribute } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";

export class Shipment extends Model<InferAttributes<Shipment>, InferCreationAttributes<Shipment>> {
  declare id: CreationOptional<string>;
  declare order_id: ForeignKey<Order["id"]>;
  declare method: CreationOptional<ShippingMethod>;
  declare carrier: string | null;
  declare tracking_number: string | null;
  declare status: CreationOptional<ShipmentStatus>;
  declare shipped_at: Date | null;
  declare delivered_at: Date | null;
  declare provider_shipment_id: string | null;
  declare raw_payload: unknown;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
}

export function initializeShipmentTable(sequelize: Sequelize): typeof Shipment {
  if (isModelInitialized(Shipment)) {
    return Shipment;
  }

  Shipment.init(
    {
      id: uuidPrimaryKeyAttribute(),
      order_id: { type: DataTypes.UUID, allowNull: false },
      method: { type: DataTypes.ENUM(...SHIPPING_METHOD_VALUES), allowNull: false, defaultValue: "standard" },
      carrier: { type: DataTypes.STRING(120), allowNull: true, validate: { len: [0, 120] } },
      tracking_number: { type: DataTypes.STRING(120), allowNull: true, validate: { len: [0, 120] } },
      status: { type: DataTypes.ENUM(...SHIPMENT_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      shipped_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      provider_shipment_id: { type: DataTypes.STRING(190), allowNull: true, unique: true, validate: { len: [0, 190] } },
      raw_payload: { type: DataTypes.JSON, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.shipments, "Shipment", false),
      indexes: [
        { unique: true, fields: ["provider_shipment_id"], name: "shipments_provider_shipment_id_unique" },
        { fields: ["order_id"], name: "shipments_order_id_idx" },
        { fields: ["status"], name: "shipments_status_idx" },
        { fields: ["tracking_number"], name: "shipments_tracking_number_idx" }
      ]
    }
  );

  return Shipment;
}