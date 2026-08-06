import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_COUNTRY_CODE, DEFAULT_CURRENCY_CODE, FULFILMENT_STATUS_VALUES, MONEY_PRECISION, MONEY_SCALE, ORDER_STATUS_VALUES, PAYMENT_STATUS_VALUES, type FulfilmentStatus, type OrderStatus, type PaymentStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, isNonNegativeDecimal, timestampModelOptions, uuidPrimaryKeyAttribute } from "../table-helpers.js";
import type { OrderItem } from "../OrderItemTable/index.js";
import type { OrderNote } from "../OrderNoteTable/index.js";
import type { Payment } from "../PaymentTable/index.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";
import type { Shipment } from "../ShipmentTable/index.js";
import type { User } from "../UserTable/index.js";

export class Order extends Model<InferAttributes<Order>, InferCreationAttributes<Order>> {
  declare id: CreationOptional<string>;
  declare order_number: string;
  declare user_id: ForeignKey<User["id"]>;
  declare status: CreationOptional<OrderStatus>;
  declare payment_status: CreationOptional<PaymentStatus>;
  declare fulfilment_status: CreationOptional<FulfilmentStatus>;
  declare subtotal: CreationOptional<string>;
  declare shipping_fee: CreationOptional<string>;
  declare total: CreationOptional<string>;
  declare currency: CreationOptional<string>;
  declare ship_recipient_name: string;
  declare ship_phone: string;
  declare ship_line_1: string;
  declare ship_line_2: string | null;
  declare ship_city: string;
  declare ship_state: string;
  declare ship_postal_code: string;
  declare ship_country: CreationOptional<string>;
  declare placed_at: CreationOptional<Date>;
  declare cancelled_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare user?: NonAttribute<User>;
  declare items?: NonAttribute<OrderItem[]>;
  declare notes?: NonAttribute<OrderNote[]>;
  declare payments?: NonAttribute<Payment[]>;
  declare shipments?: NonAttribute<Shipment[]>;
  declare returns?: NonAttribute<ReturnRequest[]>;
}

function nonNegativeMoneyValidator(fieldName: string) {
  return (value: string) => {
    if (!isNonNegativeDecimal(value)) {
      throw new Error(`${fieldName} cannot be negative.`);
    }
  };
}

export function initializeOrderTable(sequelize: Sequelize): typeof Order {
  if (isModelInitialized(Order)) {
    return Order;
  }

  Order.init(
    {
      id: uuidPrimaryKeyAttribute(),
      order_number: { type: DataTypes.STRING(50), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 50] } },
      user_id: { type: DataTypes.UUID, allowNull: false },
      status: { type: DataTypes.ENUM(...ORDER_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      payment_status: { type: DataTypes.ENUM(...PAYMENT_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      fulfilment_status: { type: DataTypes.ENUM(...FULFILMENT_STATUS_VALUES), allowNull: false, defaultValue: "unfulfilled" },
      subtotal: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: false, defaultValue: "0.00", validate: { isNonNegative: nonNegativeMoneyValidator("Subtotal") } },
      shipping_fee: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: false, defaultValue: "0.00", validate: { isNonNegative: nonNegativeMoneyValidator("Shipping fee") } },
      total: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: false, defaultValue: "0.00", validate: { isNonNegative: nonNegativeMoneyValidator("Total") } },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: DEFAULT_CURRENCY_CODE, validate: { len: [3, 3] } },
      ship_recipient_name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      ship_phone: { type: DataTypes.STRING(32), allowNull: false, validate: { notEmpty: true, len: [1, 32] } },
      ship_line_1: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true, len: [1, 255] } },
      ship_line_2: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
      ship_city: { type: DataTypes.STRING(120), allowNull: false, validate: { notEmpty: true, len: [1, 120] } },
      ship_state: { type: DataTypes.STRING(120), allowNull: false, validate: { notEmpty: true, len: [1, 120] } },
      ship_postal_code: { type: DataTypes.STRING(20), allowNull: false, validate: { notEmpty: true, len: [1, 20] } },
      ship_country: { type: DataTypes.STRING(2), allowNull: false, defaultValue: DEFAULT_COUNTRY_CODE, validate: { len: [2, 2] } },
      placed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.orders, "Order", false),
      indexes: [
        { unique: true, fields: ["order_number"], name: "orders_order_number_unique" },
        { fields: ["user_id", "placed_at"], name: "orders_user_placed_at_idx" },
        { fields: ["status", "placed_at"], name: "orders_status_placed_at_idx" },
        { fields: ["payment_status"], name: "orders_payment_status_idx" },
        { fields: ["fulfilment_status"], name: "orders_fulfilment_status_idx" },
        { fields: ["ship_state", "ship_city"], name: "orders_ship_state_city_idx" }
      ]
    }
  );

  return Order;
}