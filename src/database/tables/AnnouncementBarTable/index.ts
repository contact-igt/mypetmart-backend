import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";

export class AnnouncementBarItem extends Model<InferAttributes<AnnouncementBarItem>, InferCreationAttributes<AnnouncementBarItem>> {
  declare id: CreationOptional<number>;
  declare message: string;
  declare link_url: string | null;
  // Optional CTA label shown as its own link/chip after the message (e.g.
  // "Shop Now"). When link_url is set but link_label is null, the whole
  // message stays the link — see announcement-bar.service.ts.
  declare link_label: string | null;
  declare active: CreationOptional<boolean>;
  declare display_order: CreationOptional<number>;
  declare starts_at: Date | null;
  declare ends_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeAnnouncementBarItemTable(sequelize: Sequelize): typeof AnnouncementBarItem {
  if (isModelInitialized(AnnouncementBarItem)) {
    return AnnouncementBarItem;
  }

  AnnouncementBarItem.init(
    {
      id: numericPrimaryKeyAttribute(),
      message: { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: true, len: [1, 200] } },
      link_url: { type: DataTypes.STRING(1000), allowNull: true, validate: { len: [0, 1000] } },
      link_label: { type: DataTypes.STRING(60), allowNull: true, validate: { len: [0, 60] } },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
      starts_at: { type: DataTypes.DATE, allowNull: true },
      ends_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.announcementBarItems, "AnnouncementBarItem", false),
      indexes: [{ fields: ["active", "display_order"], name: "announcement_bar_items_active_display_order_idx" }]
    }
  );

  return AnnouncementBarItem;
}
