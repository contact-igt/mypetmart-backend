import { QueryTypes } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../constants/database.constants.js";
import { databaseConfig } from "../config/database.config.js";
import { sequelize, disconnectDatabase } from "../database/index.js";

/**
 * Truncates the media_assets table and everything that depends on it.
 *
 * media_assets is referenced by:
 *   - product_media_assignments.media_asset_id  (NOT NULL FK)      -> rows are truncated
 *   - product_images.media_asset_id             (nullable, RESTRICT) -> set to NULL
 *   - product_content_blocks.media_asset_id     (nullable)           -> set to NULL
 *
 * The id_sequences counters for the truncated tables are reset back to 1 so new
 * inserts start from a clean slate (mirrors what migration 041 seeds on create).
 *
 * Targets whatever database backend/.env resolves to (currently the production DB
 * when NODE_ENV=production). Pass --yes to actually run.
 */

const MEDIA_ASSETS = DATABASE_TABLE_NAMES.mediaAssets;
const PRODUCT_MEDIA_ASSIGNMENTS = DATABASE_TABLE_NAMES.productMediaAssignments;
const PRODUCT_IMAGES = DATABASE_TABLE_NAMES.productImages;
const PRODUCT_CONTENT_BLOCKS = DATABASE_TABLE_NAMES.productContentBlocks;

async function truncateMediaAssets(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    console.error(
      `Refusing to run without confirmation.\n` +
        `This will wipe '${MEDIA_ASSETS}' and '${PRODUCT_MEDIA_ASSIGNMENTS}', and null out ` +
        `media_asset_id on '${PRODUCT_IMAGES}' / '${PRODUCT_CONTENT_BLOCKS}'.\n` +
        `Target database: ${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.database}\n` +
        `Re-run with --yes to proceed.`
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`Connecting to ${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.database} ...`);
    await sequelize.authenticate();

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");

    console.log(`Clearing media_asset_id on ${PRODUCT_IMAGES} ...`);
    await sequelize.query(`UPDATE \`${PRODUCT_IMAGES}\` SET \`media_asset_id\` = NULL WHERE \`media_asset_id\` IS NOT NULL`);

    console.log(`Clearing media_asset_id on ${PRODUCT_CONTENT_BLOCKS} ...`);
    await sequelize.query(
      `UPDATE \`${PRODUCT_CONTENT_BLOCKS}\` SET \`media_asset_id\` = NULL WHERE \`media_asset_id\` IS NOT NULL`
    );

    console.log(`Truncating ${PRODUCT_MEDIA_ASSIGNMENTS} ...`);
    await sequelize.query(`TRUNCATE TABLE \`${PRODUCT_MEDIA_ASSIGNMENTS}\``);

    console.log(`Truncating ${MEDIA_ASSETS} ...`);
    await sequelize.query(`TRUNCATE TABLE \`${MEDIA_ASSETS}\``);

    console.log("Resetting id_sequences counters ...");
    await sequelize.query(
      "UPDATE `id_sequences` SET `next_value` = 1, `updated_at` = NOW() WHERE `sequence_name` IN (?, ?)",
      { replacements: [MEDIA_ASSETS, PRODUCT_MEDIA_ASSIGNMENTS], type: QueryTypes.UPDATE }
    );

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log("Done. media_assets and its dependents have been cleared.");
  } catch (error) {
    console.error("Error truncating media_assets:", error);
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void truncateMediaAssets();
