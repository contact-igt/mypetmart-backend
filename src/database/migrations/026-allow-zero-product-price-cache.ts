import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ConstraintRow = { constraintName: string };

export async function up({ context }: MigrationArguments): Promise<void> {
  const constraints = await context.sequelize.query<ConstraintRow>(
    "SELECT constraint_name AS constraintName FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name IN ('chk_products_price_positive', 'chk_products_price_nonnegative')",
    { type: QueryTypes.SELECT }
  );
  const names = new Set(constraints.map((row) => row.constraintName));
  if (names.has("chk_products_price_nonnegative") && !names.has("chk_products_price_positive")) return;
  if (!names.has("chk_products_price_positive") || names.has("chk_products_price_nonnegative")) {
    throw new Error("Migration 026 found an unexpected Product price-constraint state.");
  }

  await context.sequelize.query(`
    ALTER TABLE \`products\`
      DROP CONSTRAINT \`chk_products_price_positive\`,
      ADD CONSTRAINT \`chk_products_price_nonnegative\` CHECK (\`price\` >= 0);
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  // The previous schema cannot represent the zero cache used by variant
  // products. Normalize those rows before restoring its positive constraint so
  // the migration remains reversible after the upgraded application has run.
  await context.sequelize.query("UPDATE `products` SET `price` = 0.01 WHERE `price` = 0");

  await context.sequelize.query(`
    ALTER TABLE \`products\`
      DROP CONSTRAINT \`chk_products_price_nonnegative\`,
      ADD CONSTRAINT \`chk_products_price_positive\` CHECK (\`price\` > 0);
  `);
}
