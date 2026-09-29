import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, MONEY_PRECISION, MONEY_SCALE, PRODUCT_PAYMENT_METHOD_ELIGIBILITY_VALUES, type ProductPaymentMethodEligibility } from "../../../constants/database.constants.js";
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
  // This line's share of the parent Order's coupon_discount_amount_paise —
  // see CouponPricingService.allocateDiscountAcrossLines. Always 0 for an
  // Order with no coupon, or for a coupon-ineligible line.
  declare discount_allocated_paise: CreationOptional<number>;
  // This line's share of the parent Order's online_payment_discount_amount_paise
  // (Global Pay Online Discount, migration 084) — separate from the coupon
  // allocation above. Always 0 for a COD Order or when no online discount applied.
  declare online_payment_discount_allocated_paise: CreationOptional<number>;
  // The Product's payment-method eligibility frozen at Order creation (migration 083).
  declare product_payment_method_eligibility_snapshot: CreationOptional<ProductPaymentMethodEligibility>;
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
      discount_allocated_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      online_payment_discount_allocated_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      product_payment_method_eligibility_snapshot: { type: DataTypes.ENUM(...PRODUCT_PAYMENT_METHOD_ELIGIBILITY_VALUES), allowNull: false, defaultValue: "both" },
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