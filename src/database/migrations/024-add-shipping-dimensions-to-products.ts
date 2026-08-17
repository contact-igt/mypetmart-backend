import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

export async function up({ context }: MigrationArguments): Promise<void> {
  const tables = ["products", "product_variants"];
  for (const table of tables) {
    const columns = await context.sequelize.query<ColumnRow>(
      "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name IN ('weight_grams', 'length_cm', 'width_cm', 'height_cm')",
      { replacements: { table }, type: QueryTypes.SELECT }
    );
    if (columns.length === 4) continue;
    if (columns.length !== 0) {
      throw new Error(`Migration 024 found a partial shipping-dimensions schema on ${table}.`);
    }

    await context.sequelize.query(`
      ALTER TABLE \`${table}\`
        ADD COLUMN \`weight_grams\` INT UNSIGNED NULL,
        ADD COLUMN \`length_cm\` DECIMAL(8,2) NULL,
        ADD COLUMN \`width_cm\` DECIMAL(8,2) NULL,
        ADD COLUMN \`height_cm\` DECIMAL(8,2) NULL,
        ADD CONSTRAINT \`chk_${table}_weight_grams_positive\` CHECK (\`weight_grams\` IS NULL OR \`weight_grams\` > 0),
        ADD CONSTRAINT \`chk_${table}_length_cm_positive\` CHECK (\`length_cm\` IS NULL OR \`length_cm\` > 0),
        ADD CONSTRAINT \`chk_${table}_width_cm_positive\` CHECK (\`width_cm\` IS NULL OR \`width_cm\` > 0),
        ADD CONSTRAINT \`chk_${table}_height_cm_positive\` CHECK (\`height_cm\` IS NULL OR \`height_cm\` > 0);
    `);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  const tables = ["products", "product_variants"];
  for (const table of tables) {
    await context.sequelize.query(`
      ALTER TABLE \`${table}\`
        DROP CONSTRAINT \`chk_${table}_weight_grams_positive\`,
        DROP CONSTRAINT \`chk_${table}_length_cm_positive\`,
        DROP CONSTRAINT \`chk_${table}_width_cm_positive\`,
        DROP CONSTRAINT \`chk_${table}_height_cm_positive\`,
        DROP COLUMN \`weight_grams\`,
        DROP COLUMN \`length_cm\`,
        DROP COLUMN \`width_cm\`,
        DROP COLUMN \`height_cm\`;
    `);
  }
}
