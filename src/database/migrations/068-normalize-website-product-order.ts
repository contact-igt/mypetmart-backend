import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    const products = await context.sequelize.query<{ id: number }>(
      "SELECT id FROM products WHERE deleted_at IS NULL ORDER BY display_order ASC, id DESC FOR UPDATE",
      { type: QueryTypes.SELECT, transaction }
    );
    for (const [index, product] of products.entries()) {
      await context.sequelize.query("UPDATE products SET display_order = :position WHERE id = :id", { replacements: { position: index + 1, id: product.id }, transaction });
    }
  });
}

// Existing priorities cannot be recovered after normalization.
export async function down(): Promise<void> {}
