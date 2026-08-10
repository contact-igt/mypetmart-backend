import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_CURRENCY_CODE, MONEY_PRECISION, MONEY_SCALE, PAYMENT_STATUS_VALUES, type PaymentStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, isNonNegativeDecimal, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";

export class Payment extends Model<InferAttributes<Payment>, InferCreationAttributes<Payment>> {
  declare id: CreationOptional<number>;
  declare order_id: ForeignKey<Order["id"]>;
  declare provider: string;
  declare provider_order_id: string | null;
  declare provider_payment_id: string | null;
  declare status: CreationOptional<PaymentStatus>;
  declare amount: string;
  declare currency: CreationOptional<string>;
  declare method: string | null;
  declare paid_at: Date | null;
  declare failed_at: Date | null;
  declare refunded_at: Date | null;
  declare raw_payload: unknown;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
}

export function initializePaymentTable(sequelize: Sequelize): typeof Payment {
  if (isModelInitialized(Payment)) {
    return Payment;
  }

  Payment.init(
    {
      id: numericPrimaryKeyAttribute(),
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      provider: { type: DataTypes.STRING(80), allowNull: false, validate: { notEmpty: true, len: [1, 80] } },
      provider_order_id: { type: DataTypes.STRING(190), allowNull: true, unique: true, validate: { len: [0, 190] } },
      provider_payment_id: { type: DataTypes.STRING(190), allowNull: true, unique: true, validate: { len: [0, 190] } },
      status: { type: DataTypes.ENUM(...PAYMENT_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      amount: {
        type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE),
        allowNull: false,
        validate: {
          isNonNegative(value: string) {
            if (!isNonNegativeDecimal(value)) {
              throw new Error("Payment amount cannot be negative.");
            }
          }
        }
      },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: DEFAULT_CURRENCY_CODE, validate: { len: [3, 3] } },
      method: { type: DataTypes.STRING(80), allowNull: true, validate: { len: [0, 80] } },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      failed_at: { type: DataTypes.DATE, allowNull: true },
      refunded_at: { type: DataTypes.DATE, allowNull: true },
      raw_payload: { type: DataTypes.JSON, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.payments, "Payment", false),
      indexes: [
        { unique: true, fields: ["provider_order_id"], name: "payments_provider_order_id_unique" },
        { unique: true, fields: ["provider_payment_id"], name: "payments_provider_payment_id_unique" },
        { fields: ["order_id"], name: "payments_order_id_idx" },
        { fields: ["provider", "status"], name: "payments_provider_status_idx" },
        { fields: ["status"], name: "payments_status_idx" }
      ]
    }
  );

  return Payment;
}