import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, REVIEW_SOURCE_VALUES, REVIEW_STATUS_VALUES, type ReviewSource, type ReviewStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";
import type { OrderItem } from "../OrderItemTable/index.js";
import type { Product } from "../ProductTable/index.js";
import type { User } from "../UserTable/index.js";

export class ProductReview extends Model<InferAttributes<ProductReview>, InferCreationAttributes<ProductReview>> {
  declare id: CreationOptional<number>;
  declare product_id: ForeignKey<Product["id"]>;
  declare user_id: ForeignKey<User["id"]> | null;
  declare order_item_id: ForeignKey<OrderItem["id"]> | null;
  declare rating: number;
  declare title: string | null;
  declare review: string;
  declare status: CreationOptional<ReviewStatus>;
  declare verified_purchase: CreationOptional<boolean>;
  declare customer_name: string | null;
  declare review_source: CreationOptional<ReviewSource>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare product?: NonAttribute<Product>;
  declare user?: NonAttribute<User>;
  declare orderItem?: NonAttribute<OrderItem>;
}

export function initializeProductReviewTable(sequelize: Sequelize): typeof ProductReview {
  if (isModelInitialized(ProductReview)) {
    return ProductReview;
  }

  ProductReview.init(
    {
      id: numericPrimaryKeyAttribute(),
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      order_item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      rating: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, validate: { min: 1, max: 5 } },
      title: { type: DataTypes.STRING(160), allowNull: true, validate: { len: [0, 160] } },
      review: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      status: { type: DataTypes.ENUM(...REVIEW_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      verified_purchase: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      customer_name: { type: DataTypes.STRING(120), allowNull: true, validate: { len: [0, 120] } },
      review_source: { type: DataTypes.ENUM(...REVIEW_SOURCE_VALUES), allowNull: false, defaultValue: "customer" },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.productReviews, "ProductReview", false),
      indexes: [
        { unique: true, fields: ["user_id", "product_id"], name: "product_reviews_user_product_unique" },
        { fields: ["product_id", "status", "created_at"], name: "product_reviews_product_status_created_idx" },
        { fields: ["status"], name: "product_reviews_status_idx" },
        { fields: ["order_item_id"], name: "product_reviews_order_item_id_idx" }
      ]
    }
  );

  return ProductReview;
}
