import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };
type ConstraintRow = { constraintName: string };

// media_assets (041) is created after product_images (007), so the FK to it
// can never live inside 007's own CREATE TABLE text (see the comment on the
// product_images entry in schema-definition.ts) — it is added here instead,
// once media_assets is guaranteed to exist. The column + nullable r2_key
// change is applied idempotently because a fresh install already gets both
// from 007's current (updated) definition; only a database that ran the old
// 007 shape before this migration existed needs the ALTER.
export async function up({ context }: MigrationArguments): Promise<void> {
  const columns = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'product_images' AND column_name = 'media_asset_id'",
    { type: QueryTypes.SELECT }
  );

  if (columns.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`product_images\`
        ADD COLUMN \`media_asset_id\` INT UNSIGNED NULL AFTER \`product_id\`,
        MODIFY COLUMN \`r2_key\` VARCHAR(512) NULL,
        ADD KEY \`product_images_media_asset_id_idx\` (\`media_asset_id\`);
    `);
  }

  const constraints = await context.sequelize.query<ConstraintRow>(
    "SELECT constraint_name AS constraintName FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'product_images' AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'fk_product_images_media_asset_id'",
    { type: QueryTypes.SELECT }
  );

  if (constraints.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`product_images\`
        ADD CONSTRAINT \`fk_product_images_media_asset_id\` FOREIGN KEY (\`media_asset_id\`) REFERENCES \`media_assets\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT;
    `);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`product_images\`
      DROP FOREIGN KEY \`fk_product_images_media_asset_id\`,
      DROP KEY \`product_images_media_asset_id_idx\`,
      DROP COLUMN \`media_asset_id\`,
      MODIFY COLUMN \`r2_key\` VARCHAR(512) NOT NULL;
  `);
}
