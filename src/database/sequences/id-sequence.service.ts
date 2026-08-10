import { QueryTypes, type Transaction } from "sequelize";
import { sequelize } from "../index.js";

export class IdSequenceService {
  /**
   * Allocates the next sequential ID for a given table name.
   * Requires an active transaction.
   */
  public static async allocateNextId(sequenceName: string, transaction: Transaction): Promise<number> {
    if (!transaction) {
      throw new Error("Database transaction is mandatory for ID sequence allocation.");
    }

    // SELECT ... FOR UPDATE to lock the row
    const rows = await sequelize.query<{ next_value: number }>(
      "SELECT `next_value` FROM `id_sequences` WHERE `sequence_name` = ? FOR UPDATE",
      {
        replacements: [sequenceName],
        type: QueryTypes.SELECT,
        transaction
      }
    );

    let nextVal: number;
    if (rows.length === 0) {
      // Initialize if row is missing
      const now = new Date();
      await sequelize.query(
        "INSERT INTO `id_sequences` (`sequence_name`, `next_value`, `updated_at`) VALUES (?, 2, ?)",
        {
          replacements: [sequenceName, now],
          type: QueryTypes.INSERT,
          transaction
        }
      );
      return 1;
    } else {
      nextVal = rows[0]?.next_value ?? 1;
    }

    const updatedNextVal = nextVal + 1;
    const now = new Date();

    await sequelize.query(
      "UPDATE `id_sequences` SET `next_value` = ?, `updated_at` = ? WHERE `sequence_name` = ?",
      {
        replacements: [updatedNextVal, now, sequenceName],
        type: QueryTypes.UPDATE,
        transaction
      }
    );

    return nextVal;
  }

  /**
   * Allocates a contiguous range of IDs for bulk operations.
   * Requires an active transaction.
   */
  public static async allocateIdRange(
    sequenceName: string,
    count: number,
    transaction: Transaction
  ): Promise<number[]> {
    if (!transaction) {
      throw new Error("Database transaction is mandatory for ID range allocation.");
    }
    if (count <= 0) {
      throw new Error("Allocation count must be greater than zero.");
    }

    const rows = await sequelize.query<{ next_value: number }>(
      "SELECT `next_value` FROM `id_sequences` WHERE `sequence_name` = ? FOR UPDATE",
      {
        replacements: [sequenceName],
        type: QueryTypes.SELECT,
        transaction
      }
    );

    let startVal: number;
    if (rows.length === 0) {
      startVal = 1;
      const now = new Date();
      await sequelize.query(
        "INSERT INTO `id_sequences` (`sequence_name`, `next_value`, `updated_at`) VALUES (?, ?, ?)",
        {
          replacements: [sequenceName, startVal + count, now],
          type: QueryTypes.INSERT,
          transaction
        }
      );
    } else {
      startVal = rows[0]?.next_value ?? 1;
      const updatedNextVal = startVal + count;
      const now = new Date();
      await sequelize.query(
        "UPDATE `id_sequences` SET `next_value` = ?, `updated_at` = ? WHERE `sequence_name` = ?",
        {
          replacements: [updatedNextVal, now, sequenceName],
          type: QueryTypes.UPDATE,
          transaction
        }
      );
    }

    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(startVal + i);
    }
    return ids;
  }
}
