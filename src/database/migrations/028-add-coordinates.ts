import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

export async function up({ context }: MigrationArguments): Promise<void> {
  // -------------------------------------------------------------------------
  // addresses — add latitude, longitude
  // -------------------------------------------------------------------------
  const addressColumns = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'addresses' AND column_name IN ('latitude', 'longitude')",
    { type: QueryTypes.SELECT }
  );

  if (addressColumns.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`addresses\`
        ADD COLUMN \`latitude\`  DECIMAL(9,6)  NULL AFTER \`country\`,
        ADD COLUMN \`longitude\` DECIMAL(10,6) NULL AFTER \`latitude\`,
        ADD CONSTRAINT \`chk_addresses_latitude_range\`
          CHECK (\`latitude\` IS NULL OR (\`latitude\` >= -90 AND \`latitude\` <= 90)),
        ADD CONSTRAINT \`chk_addresses_longitude_range\`
          CHECK (\`longitude\` IS NULL OR (\`longitude\` >= -180 AND \`longitude\` <= 180)),
        ADD CONSTRAINT \`chk_addresses_coord_pair\`
          CHECK ((\`latitude\` IS NULL AND \`longitude\` IS NULL) OR (\`latitude\` IS NOT NULL AND \`longitude\` IS NOT NULL));
    `);
  } else if (addressColumns.length !== 2) {
    throw new Error("Migration 028 found a partial coordinate schema on addresses.");
  }

  // -------------------------------------------------------------------------
  // orders — add ship_latitude, ship_longitude
  // -------------------------------------------------------------------------
  const orderColumns = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name IN ('ship_latitude', 'ship_longitude')",
    { type: QueryTypes.SELECT }
  );

  if (orderColumns.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`orders\`
        ADD COLUMN \`ship_latitude\`  DECIMAL(9,6)  NULL AFTER \`ship_country\`,
        ADD COLUMN \`ship_longitude\` DECIMAL(10,6) NULL AFTER \`ship_latitude\`,
        ADD CONSTRAINT \`chk_orders_ship_latitude_range\`
          CHECK (\`ship_latitude\` IS NULL OR (\`ship_latitude\` >= -90 AND \`ship_latitude\` <= 90)),
        ADD CONSTRAINT \`chk_orders_ship_longitude_range\`
          CHECK (\`ship_longitude\` IS NULL OR (\`ship_longitude\` >= -180 AND \`ship_longitude\` <= 180)),
        ADD CONSTRAINT \`chk_orders_ship_coord_pair\`
          CHECK ((\`ship_latitude\` IS NULL AND \`ship_longitude\` IS NULL) OR (\`ship_latitude\` IS NOT NULL AND \`ship_longitude\` IS NOT NULL));
    `);
  } else if (orderColumns.length !== 2) {
    throw new Error("Migration 028 found a partial coordinate schema on orders.");
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  // Drop orders constraints and columns first (reverse order)
  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      DROP CONSTRAINT \`chk_orders_ship_coord_pair\`,
      DROP CONSTRAINT \`chk_orders_ship_longitude_range\`,
      DROP CONSTRAINT \`chk_orders_ship_latitude_range\`,
      DROP COLUMN \`ship_longitude\`,
      DROP COLUMN \`ship_latitude\`;
  `);

  await context.sequelize.query(`
    ALTER TABLE \`addresses\`
      DROP CONSTRAINT \`chk_addresses_coord_pair\`,
      DROP CONSTRAINT \`chk_addresses_longitude_range\`,
      DROP CONSTRAINT \`chk_addresses_latitude_range\`,
      DROP COLUMN \`longitude\`,
      DROP COLUMN \`latitude\`;
  `);
}
