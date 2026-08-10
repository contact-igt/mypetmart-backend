import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";
import type { User } from "../UserTable/index.js";

export class OrderNote extends Model<InferAttributes<OrderNote>, InferCreationAttributes<OrderNote>> {
  declare id: CreationOptional<number>;
  declare order_id: ForeignKey<Order["id"]>;
  declare admin_id: ForeignKey<User["id"]>;
  declare message: string;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
  declare author?: NonAttribute<User>;
}

export function initializeOrderNoteTable(sequelize: Sequelize): typeof OrderNote {
  if (isModelInitialized(OrderNote)) {
    return OrderNote;
  }

  OrderNote.init(
    {
      id: numericPrimaryKeyAttribute(),
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      admin_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.orderNotes, "OrderNote", false),
      indexes: [
        { fields: ["order_id", "created_at"], name: "order_notes_order_created_at_idx" },
        { fields: ["admin_id"], name: "order_notes_admin_id_idx" }
      ]
    }
  );

  return OrderNote;
}