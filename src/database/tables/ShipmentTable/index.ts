import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_CURRENCY_CODE, MONEY_PRECISION, MONEY_SCALE, SHIPMENT_SOURCE_TYPE_VALUES, SHIPMENT_STATUS_VALUES, SHIPPING_METHOD_VALUES, type ShipmentSourceType, type ShipmentStatus, type ShippingMethod } from "../../../constants/database.constants.js";
import { isModelInitialized, isNonNegativeDecimal, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";
import type { Replacement } from "../ReplacementTable/index.js";
import type { ShipmentTrackingEvent } from "../ShipmentTrackingEventTable/index.js";

export class Shipment extends Model<InferAttributes<Shipment>, InferCreationAttributes<Shipment>> {
  declare id: CreationOptional<number>;
  declare shipment_number: string;
  declare source_type: ShipmentSourceType;
  declare source_id: number;
  declare order_id: ForeignKey<Order["id"]>;
  declare replacement_id: ForeignKey<Replacement["id"]> | null;
  declare method: CreationOptional<ShippingMethod>;
  declare provider: CreationOptional<string>;
  declare provider_order_id: string | null;
  declare provider_shipment_id: string | null;
  declare carrier: string | null;
  declare tracking_number: string | null;
  declare service_type: string | null;
  declare status: CreationOptional<ShipmentStatus>;
  declare provider_status: string | null;
  declare provider_status_code: string | null;
  declare pickup_warehouse_id: string;
  declare weight_grams: number;
  declare length_cm: string;
  declare width_cm: string;
  declare height_cm: string;
  declare shipping_charge: string | null;
  declare currency: CreationOptional<string>;
  // Captured from the booked courier candidate's Rate API response (Phase
  // 2A.2) — never from Track Order (unconfirmed for this account, out of
  // scope). estimated_delivery_*_date are DATEONLY: Sequelize returns them
  // as plain "YYYY-MM-DD" strings with no timezone conversion, matching
  // iThink's own edd_date shape exactly.
  declare delivery_tat: number | null;
  declare estimated_delivery_min_date: string | null;
  declare estimated_delivery_max_date: string | null;
  declare shipped_at: Date | null;
  declare delivered_at: Date | null;
  declare cancelled_at: Date | null;
  declare rto_at: Date | null;
  declare last_synced_at: Date | null;
  declare raw_payload: unknown;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
  declare replacement?: NonAttribute<Replacement>;
  declare trackingEvents?: NonAttribute<ShipmentTrackingEvent[]>;
}

export function initializeShipmentTable(sequelize: Sequelize): typeof Shipment {
  if (isModelInitialized(Shipment)) return Shipment;
  Shipment.init(
    {
      id: numericPrimaryKeyAttribute(),
      shipment_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      source_type: { type: DataTypes.ENUM(...SHIPMENT_SOURCE_TYPE_VALUES), allowNull: false },
      source_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      replacement_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, unique: true },
      method: { type: DataTypes.ENUM(...SHIPPING_METHOD_VALUES), allowNull: false, defaultValue: "standard" },
      provider: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "ithink" },
      provider_order_id: { type: DataTypes.STRING(190), allowNull: true, unique: true },
      provider_shipment_id: { type: DataTypes.STRING(190), allowNull: true, unique: true },
      carrier: { type: DataTypes.STRING(120), allowNull: true },
      tracking_number: { type: DataTypes.STRING(120), allowNull: true, unique: true },
      service_type: { type: DataTypes.STRING(80), allowNull: true },
      status: { type: DataTypes.ENUM(...SHIPMENT_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      provider_status: { type: DataTypes.STRING(120), allowNull: true },
      provider_status_code: { type: DataTypes.STRING(80), allowNull: true },
      pickup_warehouse_id: { type: DataTypes.STRING(80), allowNull: false },
      weight_grams: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
      length_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: false, validate: { min: 0.01 } },
      width_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: false, validate: { min: 0.01 } },
      height_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: false, validate: { min: 0.01 } },
      shipping_charge: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: true, validate: { isNonNegative: (value: string) => { if (!isNonNegativeDecimal(value)) throw new Error("Shipping charge cannot be negative."); } } },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: DEFAULT_CURRENCY_CODE },
      delivery_tat: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, validate: { min: 1 } },
      estimated_delivery_min_date: { type: DataTypes.DATEONLY, allowNull: true },
      estimated_delivery_max_date: { type: DataTypes.DATEONLY, allowNull: true },
      shipped_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      rto_at: { type: DataTypes.DATE, allowNull: true },
      last_synced_at: { type: DataTypes.DATE, allowNull: true },
      raw_payload: { type: DataTypes.JSON, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.shipments, "Shipment", false),
      indexes: [
        { unique: true, fields: ["shipment_number"], name: "shipments_number_unique" },
        { unique: true, fields: ["source_type", "source_id"], name: "shipments_source_unique" },
        { unique: true, fields: ["replacement_id"], name: "shipments_replacement_id_unique" },
        { unique: true, fields: ["provider_order_id"], name: "shipments_provider_order_id_unique" },
        { unique: true, fields: ["provider_shipment_id"], name: "shipments_provider_shipment_id_unique" },
        { unique: true, fields: ["tracking_number"], name: "shipments_tracking_number_unique" },
        { fields: ["order_id"], name: "shipments_order_id_idx" },
        { fields: ["status"], name: "shipments_status_idx" }
      ]
    }
  );
  return Shipment;
}
