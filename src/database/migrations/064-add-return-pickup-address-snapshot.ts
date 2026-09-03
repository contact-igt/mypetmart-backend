import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable pickup-address snapshot on a ReturnRequest — the physical
// location a reverse courier collects the returned item from. Until now the
// reverse shipment read that address LIVE from orders.ship_* (see
// ReturnShipmentService.createForApprovedReturn), so an admin correcting a
// wrong/incomplete pickup address had nowhere to put it without mutating the
// Order's own historical shipping snapshot. These columns hold the editable
// override; every read resolves as `pickup_* ?? order.ship_*`, so a return
// with no override behaves exactly as before. NULL for every existing
// ReturnRequest — never backfilled (the fallback already covers those rows).
const COLUMN_NAMES = [
  "pickup_recipient_name",
  "pickup_phone",
  "pickup_line_1",
  "pickup_line_2",
  "pickup_city",
  "pickup_state",
  "pickup_postal_code",
  "pickup_country"
];

export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'return_requests' AND column_name = 'pickup_recipient_name'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      ADD COLUMN \`pickup_recipient_name\` VARCHAR(160) NULL AFTER \`item_received_by_admin_id\`,
      ADD COLUMN \`pickup_phone\` VARCHAR(32) NULL AFTER \`pickup_recipient_name\`,
      ADD COLUMN \`pickup_line_1\` VARCHAR(255) NULL AFTER \`pickup_phone\`,
      ADD COLUMN \`pickup_line_2\` VARCHAR(255) NULL AFTER \`pickup_line_1\`,
      ADD COLUMN \`pickup_city\` VARCHAR(120) NULL AFTER \`pickup_line_2\`,
      ADD COLUMN \`pickup_state\` VARCHAR(120) NULL AFTER \`pickup_city\`,
      ADD COLUMN \`pickup_postal_code\` VARCHAR(20) NULL AFTER \`pickup_state\`,
      ADD COLUMN \`pickup_country\` VARCHAR(2) NULL AFTER \`pickup_postal_code\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      ${COLUMN_NAMES.map((name) => `DROP COLUMN \`${name}\``).join(",\n      ")};
  `);
}
