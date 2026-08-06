import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, MONEY_PRECISION, MONEY_SCALE } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, uuidPrimaryKeyAttribute } from "../table-helpers.js";
import type { Cart } from "../CartTable/index.js";
import type { Product } from "../ProductTable/index.js";
import type { ProductVariant } from "../ProductVariantTable/index.js";

export class CartItem extends Model<InferAttributes<CartItem>, InferCreationAttributes<CartItem>> {
  declare id: CreationOptional<string>;
  declare cart_id: ForeignKey<Cart["id"]>;
  declare product_id: ForeignKey<Product["id"]>;
  declare product_variant_id: ForeignKey<ProductVariant["id"]> | null;
  declare quantity: CreationOptional<number>;
  declare unit_price_snapshot: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare cart?: NonAttribute<Cart>;
  declare product?: NonAttribute<Product>;
  declare variant?: NonAttribute<ProductVariant>;
}

export function initializeCartItemTable(sequelize: Sequelize): typeof CartItem {
  if (isModelInitialized(CartItem)) {
    return CartItem;
  }

  CartItem.init(
    {
      id: uuidPrimaryKeyAttribute(),
      cart_id: { type: DataTypes.UUID, allowNull: false },
      product_id: { type: DataTypes.UUID, allowNull: false },
      product_variant_id: { type: DataTypes.UUID, allowNull: true },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
      unit_price_snapshot: { type: DataTypes.DECIMAL(MONEY_PRECISION, MONEY_SCALE), allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.cartItems, "CartItem", false),
      indexes: [
        { fields: ["cart_id"], name: "cart_items_cart_id_idx" },
        { fields: ["product_id"], name: "cart_items_product_id_idx" },
        { fields: ["product_variant_id"], name: "cart_items_product_variant_id_idx" },
        { fields: ["cart_id", "product_id", "product_variant_id"], name: "cart_items_cart_product_variant_idx" }
      ]
    }
  );

  return CartItem;
}