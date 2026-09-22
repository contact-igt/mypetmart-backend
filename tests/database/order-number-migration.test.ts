import { describe, expect, it, vi } from "vitest";

import { up } from "../../src/database/migrations/070-migrate-order-numbers-to-mpm.js";

describe("order-number migration", () => {
  it("seeds the next MPM number without renumbering existing orders", async () => {
    const transaction = {};
    const query = vi.fn().mockResolvedValueOnce([{ nextValue: 2439 }]).mockResolvedValue(undefined);
    const sequelize = {
      query,
      transaction: async (callback: (value: typeof transaction) => Promise<void>) => callback(transaction)
    };

    await up({ context: { sequelize } as never });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM `orders` WHERE `order_number` REGEXP '^MPM-[0-9]+$'"),
      expect.objectContaining({ replacements: [2429], transaction })
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO `id_sequences`"),
      expect.objectContaining({ replacements: ["order_numbers", 2439], transaction })
    );
    expect(query.mock.calls.map(([sql]) => String(sql)).join("\n")).not.toContain("UPDATE `orders`");
  });
});
