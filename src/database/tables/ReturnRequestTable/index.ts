import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, RETURN_STATUS_VALUES, RETURN_TYPE_VALUES, type ReturnStatus, type ReturnType } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { OrderItem } from "../OrderItemTable/index.js";
import type { Order } from "../OrderTable/index.js";
import type { ReturnNote } from "../ReturnNoteTable/index.js";
import type { User } from "../UserTable/index.js";

export class ReturnRequest extends Model<InferAttributes<ReturnRequest>, InferCreationAttributes<ReturnRequest>> {
  declare id: CreationOptional<number>;
  declare return_number: CreationOptional<string>;
  declare order_id: ForeignKey<Order["id"]>;
  declare order_item_id: ForeignKey<OrderItem["id"]>;
  declare user_id: ForeignKey<User["id"]>;
  declare type: ReturnType;
  declare status: CreationOptional<ReturnStatus>;
  declare reason: string;
  declare resolution_note: string | null;
  declare evidence_image_key: string | null;
  declare evidence_image_url: string | null;
  declare requested_at: CreationOptional<Date>;
  declare resolved_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
  declare orderItem?: NonAttribute<OrderItem>;
  declare user?: NonAttribute<User>;
  declare notes?: NonAttribute<ReturnNote[]>;
}

export function initializeReturnRequestTable(sequelize: Sequelize): typeof ReturnRequest {
  if (isModelInitialized(ReturnRequest)) {
    return ReturnRequest;
  }

  ReturnRequest.init(
    {
      id: numericPrimaryKeyAttribute(),
      return_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      type: { type: DataTypes.ENUM(...RETURN_TYPE_VALUES), allowNull: false },
      status: { type: DataTypes.ENUM(...RETURN_STATUS_VALUES), allowNull: false, defaultValue: "requested" },
      reason: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      resolution_note: { type: DataTypes.TEXT, allowNull: true },
      evidence_image_key: { type: DataTypes.STRING(512), allowNull: true, validate: { len: [0, 512] } },
      evidence_image_url: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.returnRequests, "ReturnRequest", false),
      indexes: [
        { unique: true, fields: ["return_number"], name: "return_requests_return_number_unique" },
        { fields: ["status", "requested_at"], name: "return_requests_status_requested_at_idx" },
        { fields: ["order_id"], name: "return_requests_order_id_idx" },
        { fields: ["order_item_id"], name: "return_requests_order_item_id_idx" },
        { fields: ["user_id"], name: "return_requests_user_id_idx" }
      ]
    }
  );



  return ReturnRequest;
}