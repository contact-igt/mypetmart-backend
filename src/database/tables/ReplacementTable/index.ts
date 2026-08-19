import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, REPLACEMENT_STATUS_VALUES, type ReplacementStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";
import type { OrderItem } from "../OrderItemTable/index.js";
import type { Product } from "../ProductTable/index.js";
import type { ProductVariant } from "../ProductVariantTable/index.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";
import type { Shipment } from "../ShipmentTable/index.js";
import type { User } from "../UserTable/index.js";

export class Replacement extends Model<InferAttributes<Replacement>, InferCreationAttributes<Replacement>> {
  declare id: CreationOptional<number>;
  declare replacement_number: CreationOptional<string>;
  declare return_request_id: ForeignKey<ReturnRequest["id"]>;
  declare order_id: ForeignKey<Order["id"]>;
  declare order_item_id: ForeignKey<OrderItem["id"]>;
  declare product_id: ForeignKey<Product["id"]>;
  declare product_variant_id: ForeignKey<ProductVariant["id"]> | null;
  declare quantity: number;
  declare status: ReplacementStatus;
  declare approved_by_admin_id: ForeignKey<User["id"]>;
  declare stock_consumed_at: Date | null;
  declare completed_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare returnRequest?: NonAttribute<ReturnRequest>;
  declare shipment?: NonAttribute<Shipment>;
}

export function initializeReplacementTable(sequelize: Sequelize): typeof Replacement {
  if (isModelInitialized(Replacement)) return Replacement;

  Replacement.init(
    {
      id: numericPrimaryKeyAttribute(),
      replacement_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      return_request_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      product_variant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
      status: { type: DataTypes.ENUM(...REPLACEMENT_STATUS_VALUES), allowNull: false },
      approved_by_admin_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      stock_consumed_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.replacements, "Replacement", false),
      indexes: [
        { unique: true, fields: ["replacement_number"], name: "replacements_number_unique" },
        { unique: true, fields: ["return_request_id"], name: "replacements_return_request_unique" },
        { fields: ["order_id"], name: "replacements_order_id_idx" },
        { fields: ["order_item_id"], name: "replacements_order_item_id_idx" },
        { fields: ["product_id"], name: "replacements_product_id_idx" },
        { fields: ["product_variant_id"], name: "replacements_variant_id_idx" },
        { fields: ["status"], name: "replacements_status_idx" }
      ]
    }
  );
  return Replacement;
}
