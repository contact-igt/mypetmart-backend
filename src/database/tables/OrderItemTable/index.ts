import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, MONEY_PRECISION, MONEY_SCALE } from "../../../constants/database.constants.js";
import { isModelInitialized, isNonNegativeDecimal, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { Order } from "../OrderTable/index.js";
import type { Product } from "../ProductTable/index.js";
import type { ProductReview } from "../ProductReviewTable/index.js";
import type { ProductVariant } from "../ProductVariantTable/index.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";

export class OrderItem extends Model<InferAttributes<OrderItem>, InferCreationAttributes<OrderItem>> {
  declare id: CreationOptional<number>;
  declare order_id: ForeignKey<Order["id"]>;
  declare product_id: ForeignKey<Product["id"]> | null;
  declare product_variant_id: ForeignKey<ProductVariant["id"]> | null;
  declare product_name: string;
  declare product_sku: string;
  declare variant_name: string | null;
  declare variant_sku: string | null;
  declare product_image: string | null;
  declare quantity: number;
  declare unit_price: string;
  declare line_total: string;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare order?: NonAttribute<Order>;
  declare product?: NonAttribute<Product>;
  declare variant?: NonAttribute<ProductVariant>;
  declare returnRequests?: NonAttribute<ReturnRequest[]>;
  declare review?: NonAttribute<ProductReview>;
}

function nonNegativeMoneyValidator(fieldName: string) {
  return (value: string) => {
    if (!isNonNegativeDecimal(value)) {
      throw new Error(`${fieldName} cannot be negative.`);
    }
  };
}

export function initializeOrderItemTable(sequelize: Sequelize): typeof OrderItem {
  if (isModelInitialized(OrderItem)) {
    return OrderItem;
  }

  OrderItem.init(
    {
      id: numericPrimaryKeyAttribute(),
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      product_variant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      product_name: { type: DataTypes.STRING(190), allowNull: false, validate: { notEmpty: true, len: [1, 190] } },
      product_sku: { type: DataTypes.STRING(100), allowNull: false, validate: { notEmpty: true, len: [1, 100] } },
      variant_name: { type: DataTypes.STRING(160), allowNull: true, validate: { len: [0, 160] } },
      variant_sku: { type: DataTypes.STRING(100), allowNull: true, validate: { len: [0, 100] } },
      product_image: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      quantity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
      unit_price: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: false, validate: { isNonNegative: nonNegativeMoneyValidator("Unit price") } },
      line_total: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: false, validate: { isNonNegative: nonNegativeMoneyValidator("Line total") } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.orderItems, "OrderItem", false),
      indexes: [
        { fields: ["order_id"], name: "order_items_order_id_idx" },
        { fields: ["product_id"], name: "order_items_product_id_idx" },
        { fields: ["product_variant_id"], name: "order_items_product_variant_id_idx" },
        { fields: ["product_sku"], name: "order_items_product_sku_idx" },
        { fields: ["variant_sku"], name: "order_items_variant_sku_idx" }
      ]
    }
  );

  return OrderItem;
}