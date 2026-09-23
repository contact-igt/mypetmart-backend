import { Op, type Transaction } from "sequelize";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { AnnouncementBarItem } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { AnnouncementBarItemNotFoundError, InvalidAnnouncementBarItemDataError } from "./announcement-bar.errors.js";
import type {
  AdminAnnouncementBarItem,
  AnnouncementBarReorderInput,
  CreateAnnouncementBarItemInput,
  StorefrontAnnouncementBarItem,
  UpdateAnnouncementBarItemInput
} from "./announcement-bar.types.js";

export class AnnouncementBarService {
  private static validateSchedule(startsAt: Date | null, endsAt: Date | null): void {
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new InvalidAnnouncementBarItemDataError("End date must be after the start date.");
    }
  }

  public static toAdminItem(item: AnnouncementBarItem): AdminAnnouncementBarItem {
    return {
      id: item.id,
      message: item.message,
      linkUrl: item.link_url,
      linkLabel: item.link_label,
      active: item.active,
      displayOrder: item.display_order,
      startsAt: item.starts_at ? item.starts_at.toISOString() : null,
      endsAt: item.ends_at ? item.ends_at.toISOString() : null,
      createdAt: item.created_at ? item.created_at.toISOString() : new Date().toISOString(),
      updatedAt: item.updated_at ? item.updated_at.toISOString() : new Date().toISOString()
    };
  }

  public static toStorefrontItem(item: AnnouncementBarItem): StorefrontAnnouncementBarItem {
    return {
      id: item.id,
      message: item.message,
      linkUrl: item.link_url,
      linkLabel: item.link_label
    };
  }

  /**
   * Active items whose optional schedule window includes "now" — a message
   * with only a startsAt is live once that time passes, one with only an
   * endsAt is live until then, and one with neither is always live.
   */
  public static async listStorefrontItems(): Promise<StorefrontAnnouncementBarItem[]> {
    const now = new Date();

    const items = await AnnouncementBarItem.findAll({
      where: {
        active: true,
        [Op.and]: [
          { [Op.or]: [{ starts_at: null }, { starts_at: { [Op.lte]: now } }] },
          { [Op.or]: [{ ends_at: null }, { ends_at: { [Op.gte]: now } }] }
        ]
      },
      order: [
        ["display_order", "ASC"],
        ["id", "ASC"]
      ]
    });

    return items.map((item) => this.toStorefrontItem(item));
  }

  public static async listAdminItems(): Promise<AdminAnnouncementBarItem[]> {
    const items = await AnnouncementBarItem.findAll({
      order: [
        ["display_order", "ASC"],
        ["id", "ASC"]
      ]
    });

    return items.map((item) => this.toAdminItem(item));
  }

  public static async getAdminItemById(id: number): Promise<AdminAnnouncementBarItem> {
    const item = await AnnouncementBarItem.findByPk(id);
    if (!item) {
      throw new AnnouncementBarItemNotFoundError();
    }
    return this.toAdminItem(item);
  }

  public static async createItem(input: CreateAnnouncementBarItemInput): Promise<AdminAnnouncementBarItem> {
    return await sequelize.transaction(async (t: Transaction) => {
      const startsAt = input.startsAt ? new Date(input.startsAt) : null;
      const endsAt = input.endsAt ? new Date(input.endsAt) : null;
      this.validateSchedule(startsAt, endsAt);
      const allocatedId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.announcementBarItems, t);
      const displayOrder = input.displayOrder ?? allocatedId;

      const item = await AnnouncementBarItem.create(
        {
          id: allocatedId,
          message: input.message,
          link_url: input.linkUrl ?? null,
          link_label: input.linkLabel ?? null,
          active: input.active ?? true,
          display_order: displayOrder,
          starts_at: startsAt,
          ends_at: endsAt
        },
        { transaction: t }
      );

      return this.toAdminItem(item);
    });
  }

  public static async updateItem(id: number, input: UpdateAnnouncementBarItemInput): Promise<AdminAnnouncementBarItem> {
    const item = await AnnouncementBarItem.findByPk(id);
    if (!item) {
      throw new AnnouncementBarItemNotFoundError();
    }

    if (input.message !== undefined) {
      item.message = input.message;
    }
    if (input.linkUrl !== undefined) {
      item.link_url = input.linkUrl;
    }
    if (input.linkLabel !== undefined) {
      item.link_label = input.linkLabel;
    }
    if (input.active !== undefined) {
      item.active = input.active;
    }
    if (input.startsAt !== undefined) {
      item.starts_at = input.startsAt ? new Date(input.startsAt) : null;
    }
    if (input.endsAt !== undefined) {
      item.ends_at = input.endsAt ? new Date(input.endsAt) : null;
    }

    this.validateSchedule(item.starts_at, item.ends_at);

    await item.save();

    return this.toAdminItem(item);
  }

  public static async deleteItem(id: number): Promise<void> {
    const item = await AnnouncementBarItem.findByPk(id);
    if (!item) {
      throw new AnnouncementBarItemNotFoundError();
    }
    await item.destroy();
  }

  public static async reorderItems(input: AnnouncementBarReorderInput): Promise<AdminAnnouncementBarItem[]> {
    return await sequelize.transaction(async (t: Transaction) => {
      const itemIds = input.items.map((i) => i.itemId);

      const items = await AnnouncementBarItem.findAll({
        where: { id: itemIds },
        transaction: t
      });

      if (items.length !== itemIds.length) {
        throw new AnnouncementBarItemNotFoundError();
      }

      for (const entry of input.items) {
        await AnnouncementBarItem.update(
          { display_order: entry.displayOrder },
          { where: { id: entry.itemId }, transaction: t }
        );
      }

      const updatedItems = await AnnouncementBarItem.findAll({
        where: { id: itemIds },
        order: [
          ["display_order", "ASC"],
          ["id", "ASC"]
        ],
        transaction: t
      });

      return updatedItems.map((item) => this.toAdminItem(item));
    });
  }
}
