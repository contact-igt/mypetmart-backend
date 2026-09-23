import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  const columns = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'welcome_popups' AND column_name = 'coupon_id'",
    { type: QueryTypes.SELECT }
  );
  if (columns.length > 0) return;
  await context.sequelize.query(`
    ALTER TABLE \`welcome_popups\`
      ADD COLUMN \`coupon_id\` INT UNSIGNED NULL AFTER \`offer_label\`,
      ADD KEY \`welcome_popups_coupon_id_idx\` (\`coupon_id\`),
      ADD CONSTRAINT \`fk_welcome_popups_coupon_id\`
        FOREIGN KEY (\`coupon_id\`) REFERENCES \`coupons\` (\`id\`)
        ON DELETE SET NULL ON UPDATE RESTRICT;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`welcome_popups\`
      DROP FOREIGN KEY \`fk_welcome_popups_coupon_id\`,
      DROP KEY \`welcome_popups_coupon_id_idx\`,
      DROP COLUMN \`coupon_id\`;
  `);
}
