import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, PET_TYPE_VALUES, type PetType } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, uuidPrimaryKeyAttribute } from "../table-helpers.js";
import type { Product } from "../ProductTable/index.js";

export class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare slug: string;
  declare description: string | null;
  declare pet_type: CreationOptional<PetType>;
  declare active: CreationOptional<boolean>;
  declare display_order: CreationOptional<number>;
  declare image_key: string | null;
  declare image_url: string | null;
  declare image_alt: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;

  declare products?: NonAttribute<Product[]>;
}

export function initializeCategoryTable(sequelize: Sequelize): typeof Category {
  if (isModelInitialized(Category)) {
    return Category;
  }

  Category.init(
    {
      id: uuidPrimaryKeyAttribute(),
      name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      slug: { type: DataTypes.STRING(190), allowNull: false, unique: true, validate: { notEmpty: true, len: [1, 190] } },
      description: { type: DataTypes.TEXT, allowNull: true },
      pet_type: { type: DataTypes.ENUM(...PET_TYPE_VALUES), allowNull: false, defaultValue: "all" },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      image_key: { type: DataTypes.STRING(512), allowNull: true, validate: { len: [0, 512] } },
      image_url: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      image_alt: { type: DataTypes.STRING(255), allowNull: true, validate: { len: [0, 255] } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      deleted_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.categories, "Category", true),
      indexes: [
        { unique: true, fields: ["slug"], name: "categories_slug_unique" },
        { fields: ["active", "display_order"], name: "categories_active_display_order_idx" },
        { fields: ["pet_type"], name: "categories_pet_type_idx" },
        { fields: ["deleted_at"], name: "categories_deleted_at_idx" }
      ]
    }
  );

  return Category;
}