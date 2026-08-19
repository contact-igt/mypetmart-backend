import { QueryTypes } from "sequelize";

import { SHIPMENT_STATUS_VALUES } from "../../constants/database.constants.js";
import type { MigrationArguments } from "./migration-helpers.js";

const table = "shipments";
const finalColumns = ["shipment_number", "source_type", "source_id", "replacement_id", "provider", "provider_order_id", "service_type", "provider_status", "provider_status_code", "pickup_warehouse_id", "weight_grams", "length_cm", "width_cm", "height_cm", "shipping_charge", "currency", "cancelled_at", "rto_at", "last_synced_at"] as const;
const shipmentStatuses = SHIPMENT_STATUS_VALUES.map((value) => `'${value}'`).join(", ");

async function columnNames(context: MigrationArguments["context"]): Promise<Set<string>> {
  const rows = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table",
    { replacements: { table }, type: QueryTypes.SELECT }
  );
  return new Set(rows.map((row) => row.columnName));
}

async function hasReplacementForeignKey(context: MigrationArguments["context"]): Promise<boolean> {
  const rows = await context.sequelize.query<{ count: number }>(
    "SELECT COUNT(*) AS count FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = :table AND constraint_name = 'fk_shipments_replacement_id'",
    { replacements: { table }, type: QueryTypes.SELECT }
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

export async function up({ context }: MigrationArguments): Promise<void> {
  const columns = await columnNames(context);
  const present = finalColumns.filter((column) => columns.has(column));

  if (present.length > 0 && present.length < finalColumns.length) {
    throw new Error("Migration 039 found a partial iThink shipment schema; reconcile it before retrying.");
  }

  if (present.length === 0) {
    const [row] = await context.sequelize.query<{ count: number }>("SELECT COUNT(*) AS count FROM `shipments`", { type: QueryTypes.SELECT });
    if (Number(row?.count ?? 0) > 0) {
      throw new Error("Migration 039 requires existing legacy shipments to be exported/backfilled before the provider-neutral source and package snapshots can be added.");
    }

    await context.sequelize.query(`
      ALTER TABLE \`shipments\`
        DROP INDEX \`shipments_tracking_number_idx\`,
        MODIFY COLUMN \`status\` ENUM(${shipmentStatuses}) NOT NULL DEFAULT 'pending',
        ADD COLUMN \`shipment_number\` VARCHAR(50) NOT NULL AFTER \`id\`,
        ADD COLUMN \`source_type\` ENUM('order', 'replacement') NOT NULL AFTER \`shipment_number\`,
        ADD COLUMN \`source_id\` INT UNSIGNED NOT NULL AFTER \`source_type\`,
        ADD COLUMN \`replacement_id\` INT UNSIGNED NULL AFTER \`order_id\`,
        ADD COLUMN \`provider\` VARCHAR(50) NOT NULL DEFAULT 'ithink' AFTER \`method\`,
        ADD COLUMN \`provider_order_id\` VARCHAR(190) NULL AFTER \`provider\`,
        ADD COLUMN \`service_type\` VARCHAR(80) NULL AFTER \`tracking_number\`,
        ADD COLUMN \`provider_status\` VARCHAR(120) NULL AFTER \`status\`,
        ADD COLUMN \`provider_status_code\` VARCHAR(80) NULL AFTER \`provider_status\`,
        ADD COLUMN \`pickup_warehouse_id\` VARCHAR(80) NOT NULL AFTER \`provider_status_code\`,
        ADD COLUMN \`weight_grams\` INT UNSIGNED NOT NULL AFTER \`pickup_warehouse_id\`,
        ADD COLUMN \`length_cm\` DECIMAL(8,2) NOT NULL AFTER \`weight_grams\`,
        ADD COLUMN \`width_cm\` DECIMAL(8,2) NOT NULL AFTER \`length_cm\`,
        ADD COLUMN \`height_cm\` DECIMAL(8,2) NOT NULL AFTER \`width_cm\`,
        ADD COLUMN \`shipping_charge\` DECIMAL(10,2) NULL AFTER \`height_cm\`,
        ADD COLUMN \`currency\` CHAR(3) NOT NULL DEFAULT 'INR' AFTER \`shipping_charge\`,
        ADD COLUMN \`cancelled_at\` DATETIME NULL AFTER \`delivered_at\`,
        ADD COLUMN \`rto_at\` DATETIME NULL AFTER \`cancelled_at\`,
        ADD COLUMN \`last_synced_at\` DATETIME NULL AFTER \`rto_at\`,
        ADD UNIQUE KEY \`shipments_number_unique\` (\`shipment_number\`),
        ADD UNIQUE KEY \`shipments_source_unique\` (\`source_type\`, \`source_id\`),
        ADD UNIQUE KEY \`shipments_replacement_id_unique\` (\`replacement_id\`),
        ADD UNIQUE KEY \`shipments_provider_order_id_unique\` (\`provider_order_id\`),
        ADD UNIQUE KEY \`shipments_tracking_number_unique\` (\`tracking_number\`),
        ADD CONSTRAINT \`chk_shipments_source\` CHECK ((\`source_type\` = 'order' AND \`source_id\` = \`order_id\` AND \`replacement_id\` IS NULL) OR (\`source_type\` = 'replacement' AND \`source_id\` = \`replacement_id\` AND \`replacement_id\` IS NOT NULL)),
        ADD CONSTRAINT \`chk_shipments_weight_positive\` CHECK (\`weight_grams\` > 0),
        ADD CONSTRAINT \`chk_shipments_dimensions_positive\` CHECK (\`length_cm\` > 0 AND \`width_cm\` > 0 AND \`height_cm\` > 0),
        ADD CONSTRAINT \`chk_shipments_charge_nonnegative\` CHECK (\`shipping_charge\` IS NULL OR \`shipping_charge\` >= 0);
    `);
  }

  if (!(await hasReplacementForeignKey(context))) {
    await context.sequelize.query("ALTER TABLE `shipments` ADD CONSTRAINT `fk_shipments_replacement_id` FOREIGN KEY (`replacement_id`) REFERENCES `replacements` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT");
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("ALTER TABLE `shipments` DROP FOREIGN KEY `fk_shipments_replacement_id`");
  await context.sequelize.query(`
    ALTER TABLE \`shipments\`
      DROP CONSTRAINT \`chk_shipments_source\`,
      DROP CONSTRAINT \`chk_shipments_weight_positive\`,
      DROP CONSTRAINT \`chk_shipments_dimensions_positive\`,
      DROP CONSTRAINT \`chk_shipments_charge_nonnegative\`,
      DROP INDEX \`shipments_number_unique\`,
      DROP INDEX \`shipments_source_unique\`,
      DROP INDEX \`shipments_replacement_id_unique\`,
      DROP INDEX \`shipments_provider_order_id_unique\`,
      DROP INDEX \`shipments_tracking_number_unique\`,
      ADD KEY \`shipments_tracking_number_idx\` (\`tracking_number\`),
      DROP COLUMN \`shipment_number\`, DROP COLUMN \`source_type\`, DROP COLUMN \`source_id\`, DROP COLUMN \`replacement_id\`,
      DROP COLUMN \`provider\`, DROP COLUMN \`provider_order_id\`, DROP COLUMN \`service_type\`, DROP COLUMN \`provider_status\`,
      DROP COLUMN \`provider_status_code\`, DROP COLUMN \`pickup_warehouse_id\`, DROP COLUMN \`weight_grams\`, DROP COLUMN \`length_cm\`,
      DROP COLUMN \`width_cm\`, DROP COLUMN \`height_cm\`, DROP COLUMN \`shipping_charge\`, DROP COLUMN \`currency\`,
      DROP COLUMN \`cancelled_at\`, DROP COLUMN \`rto_at\`, DROP COLUMN \`last_synced_at\`,
      MODIFY COLUMN \`status\` ENUM('pending', 'processing', 'shipped', 'delivered', 'failed', 'cancelled') NOT NULL DEFAULT 'pending';
  `);
}
