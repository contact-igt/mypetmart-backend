import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";
import type { Product } from "../ProductTable/index.js";
import type { User } from "../UserTable/index.js";

export class Wishlist extends Model<InferAttributes<Wishlist>, InferCreationAttributes<Wishlist>> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<User["id"]>;
  declare product_id: ForeignKey<Product["id"]>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare user?: NonAttribute<User>;
  declare product?: NonAttribute<Product>;
}

export function initializeWishlistTable(sequelize: Sequelize): typeof Wishlist {
  if (isModelInitialized(Wishlist)) {
    return Wishlist;
  }

  Wishlist.init(
    {
      id: numericPrimaryKeyAttribute(),
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.wishlists, "Wishlist", false),
      indexes: [
        { unique: true, fields: ["user_id", "product_id"], name: "wishlists_user_product_unique" },
        { fields: ["user_id"], name: "wishlists_user_id_idx" },
        { fields: ["product_id"], name: "wishlists_product_id_idx" }
      ]
    }
  );

  return Wishlist;
}
