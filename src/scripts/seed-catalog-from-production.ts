import { QueryTypes, Sequelize, Transaction } from "sequelize";

import { environmentConfig } from "../config/environment.config.js";

const CATALOG_TABLES = ["categories", "products", "product_variants", "product_images"] as const;
type CatalogTable = (typeof CATALOG_TABLES)[number];
type DatabaseRow = Record<string, unknown>;
type CountRow = { count: number };
type MigrationRow = { name: string };

const REFERENCE_TABLES = ["cart_items", "order_items", "wishlists", "replacements"] as const;
const referenceQueries: Record<(typeof REFERENCE_TABLES)[number], string> = {
  cart_items: "SELECT COUNT(*) AS count FROM `cart_items` WHERE `product_id` IS NOT NULL OR `product_variant_id` IS NOT NULL",
  order_items: "SELECT COUNT(*) AS count FROM `order_items` WHERE `product_id` IS NOT NULL OR `product_variant_id` IS NOT NULL",
  wishlists: "SELECT COUNT(*) AS count FROM `wishlists` WHERE `product_id` IS NOT NULL",
  replacements: "SELECT COUNT(*) AS count FROM `replacements` WHERE `product_id` IS NOT NULL OR `product_variant_id` IS NOT NULL"
};

const sourceQueries: Record<CatalogTable, string> = {
  categories: "SELECT * FROM `categories` WHERE `deleted_at` IS NULL ORDER BY `id`",
  products: "SELECT * FROM `products` WHERE `deleted_at` IS NULL ORDER BY `id`",
  product_variants:
    "SELECT v.* FROM `product_variants` v INNER JOIN `products` p ON p.`id` = v.`product_id` WHERE v.`deleted_at` IS NULL AND p.`deleted_at` IS NULL ORDER BY v.`id`",
  product_images:
    "SELECT i.* FROM `product_images` i INNER JOIN `products` p ON p.`id` = i.`product_id` WHERE i.`deleted_at` IS NULL AND p.`deleted_at` IS NULL ORDER BY i.`id`"
};

function requiredProductionValue(name: string, value: string | number | undefined): string | number {
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to seed the local catalog from production.`);
  }
  return value;
}

function createConnections(): { local: Sequelize; production: Sequelize } {
  const localHost = environmentConfig.DB_HOST.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(localHost)) {
    throw new Error("Catalog import destination must use a loopback DB_HOST (localhost, 127.0.0.1, or ::1).");
  }

  const productionHost = String(requiredProductionValue("PRODUCTION_DB_HOST", environmentConfig.PRODUCTION_DB_HOST));
  const productionPort = Number(requiredProductionValue("PRODUCTION_DB_PORT", environmentConfig.PRODUCTION_DB_PORT));
  const productionDatabase = String(requiredProductionValue("PRODUCTION_DB_NAME", environmentConfig.PRODUCTION_DB_NAME));
  const productionUser = String(requiredProductionValue("PRODUCTION_DB_USER", environmentConfig.PRODUCTION_DB_USER));
  const productionPassword = String(requiredProductionValue("PRODUCTION_DB_PASSWORD", environmentConfig.PRODUCTION_DB_PASSWORD));

  const sameTarget =
    environmentConfig.DB_HOST === productionHost &&
    environmentConfig.DB_PORT === productionPort &&
    environmentConfig.DB_NAME === productionDatabase;
  if (sameTarget) {
    throw new Error("Local and production database targets are identical; import aborted.");
  }

  const commonOptions = { dialect: "mysql" as const, logging: false, pool: { max: 2, min: 0, acquire: 30_000, idle: 10_000 } };
  return {
    local: new Sequelize(environmentConfig.DB_NAME, environmentConfig.DB_USER, environmentConfig.DB_PASSWORD, {
      ...commonOptions,
      host: localHost === "localhost" ? "127.0.0.1" : environmentConfig.DB_HOST,
      port: environmentConfig.DB_PORT
    }),
    production: new Sequelize(productionDatabase, productionUser, productionPassword, {
      ...commonOptions,
      host: productionHost,
      port: productionPort
    })
  };
}

async function migrationNames(database: Sequelize): Promise<string[]> {
  const rows = await database.query<MigrationRow>("SELECT `name` FROM `SequelizeMeta` ORDER BY `name`", { type: QueryTypes.SELECT });
  return rows.map((row) => row.name);
}

async function assertMatchingSchemas(local: Sequelize, production: Sequelize): Promise<void> {
  const [localMigrations, productionMigrations] = await Promise.all([migrationNames(local), migrationNames(production)]);
  if (localMigrations.length === 0 || JSON.stringify(localMigrations) !== JSON.stringify(productionMigrations)) {
    const missingLocally = productionMigrations.filter((name) => !localMigrations.includes(name));
    const localOnly = localMigrations.filter((name) => !productionMigrations.includes(name));
    throw new Error(
      `Local and production migration histories do not match. Missing locally: ${missingLocally.join(", ") || "none"}. Local-only: ${localOnly.join(", ") || "none"}.`
    );
  }
}

async function catalogCounts(database: Sequelize): Promise<Record<CatalogTable | "sku_reservations", number>> {
  const counts = {} as Record<CatalogTable | "sku_reservations", number>;
  for (const table of CATALOG_TABLES) {
    const [row] = await database.query<CountRow>(`SELECT COUNT(*) AS count FROM \`${table}\``, { type: QueryTypes.SELECT });
    counts[table] = Number(row?.count ?? 0);
  }
  const [reservationRow] = await database.query<CountRow>("SELECT COUNT(*) AS count FROM `catalog_sku_reservations`", {
    type: QueryTypes.SELECT
  });
  counts.sku_reservations = Number(reservationRow?.count ?? 0);
  return counts;
}

async function catalogReferenceCounts(database: Sequelize): Promise<Record<(typeof REFERENCE_TABLES)[number], number>> {
  const counts = {} as Record<(typeof REFERENCE_TABLES)[number], number>;
  for (const table of REFERENCE_TABLES) {
    const [row] = await database.query<CountRow>(referenceQueries[table], { type: QueryTypes.SELECT });
    counts[table] = Number(row?.count ?? 0);
  }
  return counts;
}

function isEmptyCatalog(counts: Record<string, number>): boolean {
  return Object.values(counts).every((count) => count === 0);
}

async function readProductionCatalog(production: Sequelize): Promise<Record<CatalogTable, DatabaseRow[]>> {
  return await production.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true },
    async (transaction) => {
      const catalog = {} as Record<CatalogTable, DatabaseRow[]>;
      for (const table of CATALOG_TABLES) {
        catalog[table] = await production.query<DatabaseRow>(sourceQueries[table], { type: QueryTypes.SELECT, transaction });
      }

      for (const product of catalog.products) {
        if (product.tags !== null && typeof product.tags !== "string") {
          product.tags = JSON.stringify(product.tags);
        }
      }
      for (const image of catalog.product_images) {
        delete image.primary_product_id;
        image.media_asset_id = null;
      }
      return catalog;
    }
  );
}

async function importCatalog(local: Sequelize, catalog: Record<CatalogTable, DatabaseRow[]>, replaceLocalCatalog: boolean): Promise<void> {
  await local.transaction(async (transaction) => {
    const queryInterface = local.getQueryInterface();
    if (replaceLocalCatalog) {
      await local.query("DELETE FROM `catalog_sku_reservations`", { transaction });
      for (const table of [...CATALOG_TABLES].reverse()) {
        await local.query(`DELETE FROM \`${table}\``, { transaction });
      }
    }

    for (const table of CATALOG_TABLES) {
      if (catalog[table].length > 0) {
        await queryInterface.bulkInsert(table, catalog[table], { transaction });
      }
    }

    await local.query(
      "INSERT INTO `catalog_sku_reservations` (`sku`, `entity_type`, `entity_id`, `reserved_at`) SELECT UPPER(TRIM(`sku`)), 'product', `id`, NOW() FROM `products` UNION ALL SELECT UPPER(TRIM(`sku`)), 'variant', `id`, NOW() FROM `product_variants`",
      { transaction }
    );

    for (const table of CATALOG_TABLES) {
      await local.query(
        `INSERT INTO \`id_sequences\` (\`sequence_name\`, \`next_value\`, \`updated_at\`) SELECT :table, COALESCE(MAX(\`id\`), 0) + 1, NOW() FROM \`${table}\` ON DUPLICATE KEY UPDATE \`next_value\` = VALUES(\`next_value\`), \`updated_at\` = VALUES(\`updated_at\`)`,
        { replacements: { table }, transaction }
      );
    }
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--preview");
  const replaceLocalCatalog = process.argv.includes("--replace-local-catalog");
  const { local, production } = createConnections();
  try {
    const [localConnection, productionConnection] = await Promise.allSettled([local.authenticate(), production.authenticate()]);
    const connectionFailures: string[] = [];
    if (localConnection.status === "rejected") {
      connectionFailures.push(`Local database connection failed: ${localConnection.reason instanceof Error ? localConnection.reason.message : "unknown error"}`);
    }
    if (productionConnection.status === "rejected") {
      connectionFailures.push(
        `Production database connection failed: ${productionConnection.reason instanceof Error ? productionConnection.reason.message : "unknown error"}`
      );
    }
    if (connectionFailures.length > 0) {
      throw new Error(connectionFailures.join(" "));
    }
    await assertMatchingSchemas(local, production);

    const [localCounts, referenceCounts, catalog] = await Promise.all([
      catalogCounts(local),
      catalogReferenceCounts(local),
      readProductionCatalog(production)
    ]);
    const sourceCounts = Object.fromEntries(CATALOG_TABLES.map((table) => [table, catalog[table].length]));
    const localCatalogEmpty = isEmptyCatalog(localCounts);
    const replaceable = isEmptyCatalog(referenceCounts);
    const importable = localCatalogEmpty || (replaceLocalCatalog && replaceable);

    if (dryRun) {
      console.log(JSON.stringify({ preview: true, importable, replaceable, localCounts, referenceCounts, sourceCounts }, null, 2));
      return;
    }
    if (!localCatalogEmpty && !replaceLocalCatalog) {
      throw new Error("Local catalog is not empty. This command will not overwrite local catalog data; use --preview to inspect counts.");
    }
    if (!replaceable) {
      throw new Error(`Local catalog replacement is blocked by references: ${JSON.stringify(referenceCounts)}.`);
    }

    await importCatalog(local, catalog, replaceLocalCatalog);
    console.log(JSON.stringify({ imported: sourceCounts, replacedLocalCatalog: replaceLocalCatalog, imageMediaAssetLinksDetached: true }, null, 2));
  } finally {
    await Promise.allSettled([local.close(), production.close()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Production catalog import failed.");
  process.exitCode = 1;
});
