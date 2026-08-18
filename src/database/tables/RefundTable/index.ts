import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_CURRENCY_CODE, MONEY_PRECISION, MONEY_SCALE, REFUND_STATUS_VALUES, type RefundStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, isPositiveDecimal, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";
import type { Payment } from "../PaymentTable/index.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";
import type { User } from "../UserTable/index.js";

export class Refund extends Model<InferAttributes<Refund>, InferCreationAttributes<Refund>> {
  declare id: CreationOptional<number>;
  declare refund_number: CreationOptional<string>;
  declare order_id: ForeignKey<Order["id"]>;
  declare payment_id: ForeignKey<Payment["id"]>;
  declare return_request_id: ForeignKey<ReturnRequest["id"]> | null;
  declare provider: string;
  declare provider_refund_token: string;
  declare provider_request_id: string | null;
  declare provider_refund_id: string | null;
  declare provider_status: string | null;
  declare status: CreationOptional<RefundStatus>;
  declare amount: string;
  declare currency: CreationOptional<string>;
  declare failure_code: string | null;
  declare failure_message: string | null;
  declare initiated_by_admin_id: ForeignKey<User["id"]>;
  declare initiated_at: CreationOptional<Date>;
  declare completed_at: Date | null;
  declare failed_at: Date | null;
  declare raw_payload: unknown;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
  declare payment?: NonAttribute<Payment>;
  declare returnRequest?: NonAttribute<ReturnRequest>;
  declare initiatedBy?: NonAttribute<User>;
}

export function initializeRefundTable(sequelize: Sequelize): typeof Refund {
  if (isModelInitialized(Refund)) {
    return Refund;
  }

  Refund.init(
    {
      id: numericPrimaryKeyAttribute(),
      refund_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      payment_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      return_request_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      provider: { type: DataTypes.STRING(80), allowNull: false, validate: { notEmpty: true, len: [1, 80] } },
      provider_refund_token: { type: DataTypes.STRING(190), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 190] } },
      provider_request_id: { type: DataTypes.STRING(190), allowNull: true, validate: { len: [0, 190] } },
      provider_refund_id: { type: DataTypes.STRING(190), allowNull: true, unique: true, validate: { len: [0, 190] } },
      provider_status: { type: DataTypes.STRING(80), allowNull: true, validate: { len: [0, 80] } },
      status: { type: DataTypes.ENUM(...REFUND_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      amount: {
        type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE),
        allowNull: false,
        validate: {
          isPositive(value: string) {
            if (!isPositiveDecimal(value)) {
              throw new Error("Refund amount must be greater than zero.");
            }
          }
        }
      },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: DEFAULT_CURRENCY_CODE, validate: { len: [3, 3] } },
      failure_code: { type: DataTypes.STRING(120), allowNull: true, validate: { len: [0, 120] } },
      failure_message: { type: DataTypes.STRING(500), allowNull: true, validate: { len: [0, 500] } },
      initiated_by_admin_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      initiated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      failed_at: { type: DataTypes.DATE, allowNull: true },
      raw_payload: { type: DataTypes.JSON, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.refunds, "Refund", false),
      indexes: [
        { unique: true, fields: ["refund_number"], name: "refunds_refund_number_unique" },
        { unique: true, fields: ["provider_refund_token"], name: "refunds_provider_refund_token_unique" },
        { unique: true, fields: ["provider_refund_id"], name: "refunds_provider_refund_id_unique" },
        { fields: ["order_id"], name: "refunds_order_id_idx" },
        { fields: ["payment_id"], name: "refunds_payment_id_idx" },
        { fields: ["return_request_id"], name: "refunds_return_request_id_idx" },
        { fields: ["status"], name: "refunds_status_idx" },
        { fields: ["initiated_by_admin_id"], name: "refunds_initiated_by_admin_id_idx" }
      ]
    }
  );

  return Refund;
}
