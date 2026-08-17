import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  const sequelize = context.sequelize;

  await sequelize.query(`
    CREATE TABLE \`catalog_sku_reservations\` (
      \`sku\` VARCHAR(100) NOT NULL,
      \`entity_type\` ENUM('product', 'variant') NOT NULL,
      \`entity_id\` INT UNSIGNED NOT NULL,
      \`reserved_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`sku\`),
      KEY \`catalog_sku_reservations_entity_idx\` (\`entity_type\`, \`entity_id\`),
      CONSTRAINT \`chk_catalog_sku_reservations_entity_id_positive\` CHECK (\`entity_id\` > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Backfill existing products and variants SKUs
  const products = await sequelize.query<{ id: number; sku: string }>(
    "SELECT `id`, `sku` FROM `products`",
    { type: QueryTypes.SELECT }
  );

  const variants = await sequelize.query<{ id: number; sku: string }>(
    "SELECT `id`, `sku` FROM `product_variants`",
    { type: QueryTypes.SELECT }
  );

  const reservedSkus = new Map<string, { entity_type: "product" | "variant"; entity_id: number }>();

  for (const p of products) {
    if (!p.sku) continue;
    const normalized = p.sku.trim().toUpperCase();
    if (reservedSkus.has(normalized)) {
      throw new Error(`SKU migration conflict detected: '${normalized}' is duplicated across existing catalog rows.`);
    }
    reservedSkus.set(normalized, { entity_type: "product", entity_id: p.id });
  }

  for (const v of variants) {
    if (!v.sku) continue;
    const normalized = v.sku.trim().toUpperCase();
    if (reservedSkus.has(normalized)) {
      throw new Error(`SKU migration conflict detected: '${normalized}' is duplicated across existing catalog rows.`);
    }
    reservedSkus.set(normalized, { entity_type: "variant", entity_id: v.id });
  }

  for (const [sku, item] of reservedSkus.entries()) {
    await sequelize.query(
      "INSERT INTO `catalog_sku_reservations` (`sku`, `entity_type`, `entity_id`, `reserved_at`) VALUES (?, ?, ?, NOW())",
      {
        replacements: [sku, item.entity_type, item.entity_id],
        type: QueryTypes.INSERT
      }
    );
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("DROP TABLE IF EXISTS `catalog_sku_reservations`;");
}
