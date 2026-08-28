import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_CURRENCY_CODE, MONEY_PRECISION, MONEY_SCALE, RETURN_SHIPMENT_STATUS_VALUES, type ReturnShipmentStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, isNonNegativeDecimal, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";
import type { ReturnShipmentTrackingEvent } from "../ReturnShipmentTrackingEventTable/index.js";

// Reverse (customer -> warehouse) courier shipment for one approved
// ReturnRequest — Phase F.1. Deliberately its own table, not a row on the
// existing forward `shipments` table: source_type there is "order" |
// "replacement" (both forward movements — a Replacement's own shipment
// still goes warehouse -> customer), and bolting a third, opposite-direction
// meaning onto that same table/status vocabulary would blur an otherwise
// clean invariant. See backend/docs (Phase F.1 report) for the full
// architecture rationale.
export class ReturnShipment extends Model<InferAttributes<ReturnShipment>, InferCreationAttributes<ReturnShipment>> {
  declare id: CreationOptional<number>;
  declare return_request_id: ForeignKey<ReturnRequest["id"]>;
  declare shipment_number: string;
  declare provider: CreationOptional<string>;
  declare provider_order_id: string | null;
  declare carrier: string | null;
  declare awb_number: string | null;
  declare service_type: string | null;
  declare status: CreationOptional<ReturnShipmentStatus>;
  declare provider_status: string | null;
  declare provider_status_code: string | null;
  declare weight_grams: number;
  declare length_cm: string;
  declare width_cm: string;
  declare height_cm: string;
  declare shipping_charge: string | null;
  declare currency: CreationOptional<string>;
  declare tracking_url: string | null;
  declare raw_payload: unknown;
  declare picked_up_at: Date | null;
  declare delivered_at: Date | null;
  declare cancelled_at: Date | null;
  declare last_synced_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare returnRequest?: NonAttribute<ReturnRequest>;
  declare trackingEvents?: NonAttribute<ReturnShipmentTrackingEvent[]>;
}

function nonNegativeMoneyValidator(fieldName: string) {
  return (value: string) => {
    if (!isNonNegativeDecimal(value)) {
      throw new Error(`${fieldName} cannot be negative.`);
    }
  };
}

export function initializeReturnShipmentTable(sequelize: Sequelize): typeof ReturnShipment {
  if (isModelInitialized(ReturnShipment)) return ReturnShipment;

  ReturnShipment.init(
    {
      id: numericPrimaryKeyAttribute(),
      return_request_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      shipment_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      provider: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "ithink" },
      provider_order_id: { type: DataTypes.STRING(190), allowNull: true, unique: true },
      carrier: { type: DataTypes.STRING(120), allowNull: true },
      awb_number: { type: DataTypes.STRING(120), allowNull: true, unique: true },
      service_type: { type: DataTypes.STRING(80), allowNull: true },
      status: { type: DataTypes.ENUM(...RETURN_SHIPMENT_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      provider_status: { type: DataTypes.STRING(120), allowNull: true },
      provider_status_code: { type: DataTypes.STRING(80), allowNull: true },
      weight_grams: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
      length_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: false, validate: { min: 0.01 } },
      width_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: false, validate: { min: 0.01 } },
      height_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: false, validate: { min: 0.01 } },
      shipping_charge: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: true, validate: { isNonNegative: nonNegativeMoneyValidator("Shipping charge") } },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: DEFAULT_CURRENCY_CODE },
      tracking_url: { type: DataTypes.STRING(1000), allowNull: true },
      raw_payload: { type: DataTypes.JSON, allowNull: true },
      picked_up_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      last_synced_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.returnShipments, "ReturnShipment", false),
      indexes: [
        { unique: true, fields: ["shipment_number"], name: "return_shipments_number_unique" },
        { unique: true, fields: ["return_request_id"], name: "return_shipments_return_request_unique" },
        { unique: true, fields: ["provider_order_id"], name: "return_shipments_provider_order_id_unique" },
        { unique: true, fields: ["awb_number"], name: "return_shipments_awb_number_unique" },
        { fields: ["status"], name: "return_shipments_status_idx" }
      ]
    }
  );

  return ReturnShipment;
}
