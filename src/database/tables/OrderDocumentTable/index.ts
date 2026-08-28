import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, ORDER_DOCUMENT_TYPE_VALUES, type OrderDocumentType } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";

// One durable, immutable business-reference row per (Order, document type) —
// assigned exactly once (see receipt.service.ts's find-or-create) and reused
// on every repeat download, never regenerated with a new number. "type" is
// deliberately an open ENUM (currently just "receipt") so a future GST
// invoice reuses this same table as a second document_type instead of a
// parallel numbering scheme.
export class OrderDocument extends Model<InferAttributes<OrderDocument>, InferCreationAttributes<OrderDocument>> {
  declare id: CreationOptional<number>;
  declare order_id: ForeignKey<Order["id"]>;
  declare document_type: OrderDocumentType;
  declare document_number: string;
  declare generated_at: Date;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
}

export function initializeOrderDocumentTable(sequelize: Sequelize): typeof OrderDocument {
  if (isModelInitialized(OrderDocument)) return OrderDocument;

  OrderDocument.init(
    {
      id: numericPrimaryKeyAttribute(),
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      document_type: { type: DataTypes.ENUM(...ORDER_DOCUMENT_TYPE_VALUES), allowNull: false },
      document_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      generated_at: { type: DataTypes.DATE, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.orderDocuments, "OrderDocument", false),
      indexes: [
        { unique: true, fields: ["document_number"], name: "order_documents_number_unique" },
        { unique: true, fields: ["order_id", "document_type"], name: "order_documents_order_type_unique" }
      ]
    }
  );

  return OrderDocument;
}
