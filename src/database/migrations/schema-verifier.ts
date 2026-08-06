import { QueryTypes, type Sequelize } from "sequelize";

import { sequelize } from "../index.js";
import { createMigrator } from "./migrator.js";
import {
  EXPECTED_BUSINESS_TABLE_NAMES,
  EXPECTED_METADATA_TABLE_NAME,
  expectedChecksFor,
  expectedColumnsFor,
  expectedForeignKeysFor,
  expectedIndexesFor,
  INITIAL_SCHEMA_TABLES
} from "./schema-definition.js";

type TableRow = { tableName: string };
type ColumnRow = { tableName: string; columnName: string; isNullable: "YES" | "NO"; dataType: string; extra: string };
type IndexRow = { tableName: string; indexName: string; nonUnique: number; columns: string };
type ForeignKeyRow = {
  tableName: string;
  constraintName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  updateRule: string;
  deleteRule: string;
};
type CheckRow = { constraintName: string };

export type SchemaVerificationResult = {
  ok: boolean;
  failures: string[];
};

const normalizeList = (values: readonly string[]): string[] => [...values].sort((left, right) => left.localeCompare(right));

async function getActualTables(database: Sequelize): Promise<string[]> {
  const rows = await database.query<TableRow>(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
    { type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.tableName);
}

export async function assertOnlyExpectedSchemaTables(database: Sequelize = sequelize): Promise<void> {
  const actualTables = await getActualTables(database);
  const expected = new Set([...EXPECTED_BUSINESS_TABLE_NAMES, EXPECTED_METADATA_TABLE_NAME].map((table) => table.toLowerCase()));
  const unexpected = actualTables.filter((table) => !expected.has(table.toLowerCase()));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected tables found in schema: ${unexpected.join(", ")}`);
  }
}

export async function verifySchema(options: { database?: Sequelize; expectEmpty?: boolean } = {}): Promise<SchemaVerificationResult> {
  const database = options.database ?? sequelize;
  const failures: string[] = [];
  const actualTables = await getActualTables(database);

  if (options.expectEmpty === true) {
    if (actualTables.length > 0) failures.push(`Expected an empty schema, found: ${actualTables.join(", ")}`);
    return { ok: failures.length === 0, failures };
  }

  const expectedTables = normalizeList([...EXPECTED_BUSINESS_TABLE_NAMES, EXPECTED_METADATA_TABLE_NAME].map((table) => table.toLowerCase()));
  const actualSortedTables = normalizeList(actualTables.map((table) => table.toLowerCase()));
  if (actualSortedTables.join("|") !== expectedTables.join("|")) {
    failures.push(`Table mismatch. Expected ${expectedTables.join(", ")}; found ${actualSortedTables.join(", ")}`);
  }

  const pending = await createMigrator(database).pending();
  if (pending.length > 0) {
    failures.push(`Pending migrations remain: ${pending.map((migration) => migration.name).join(", ")}`);
  }

  const [columns, indexes, foreignKeys, checks] = await Promise.all([
    database.query<ColumnRow>(
      "SELECT table_name AS tableName, column_name AS columnName, is_nullable AS isNullable, data_type AS dataType, extra AS extra FROM information_schema.columns WHERE table_schema = DATABASE()",
      { type: QueryTypes.SELECT }
    ),
    database.query<IndexRow>(
      "SELECT table_name AS tableName, index_name AS indexName, non_unique AS nonUnique, GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS columns FROM information_schema.statistics WHERE table_schema = DATABASE() GROUP BY table_name, index_name, non_unique",
      { type: QueryTypes.SELECT }
    ),
    database.query<ForeignKeyRow>(
      "SELECT kcu.table_name AS tableName, kcu.constraint_name AS constraintName, kcu.column_name AS columnName, kcu.referenced_table_name AS referencedTableName, kcu.referenced_column_name AS referencedColumnName, rc.update_rule AS updateRule, rc.delete_rule AS deleteRule FROM information_schema.key_column_usage kcu JOIN information_schema.referential_constraints rc ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name WHERE kcu.table_schema = DATABASE() AND kcu.referenced_table_name IS NOT NULL",
      { type: QueryTypes.SELECT }
    ),
    database.query<CheckRow>(
      "SELECT constraint_name AS constraintName FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()",
      { type: QueryTypes.SELECT }
    )
  ]);

  const actualColumnMap = new Map(columns.map((row) => [`${row.tableName}.${row.columnName}`, row]));
  const actualIndexMap = new Map(indexes.map((row) => [`${row.tableName}.${row.indexName}`, row]));
  const actualForeignKeyMap = new Map(foreignKeys.map((row) => [`${row.tableName}.${row.constraintName}`, row]));
  const actualCheckNames = new Set(checks.map((row) => row.constraintName));

  for (const table of INITIAL_SCHEMA_TABLES) {
    for (const expectedColumn of expectedColumnsFor(table)) {
      const actual = actualColumnMap.get(`${table.tableName}.${expectedColumn.name}`);
      if (!actual) {
        failures.push(`Missing column ${table.tableName}.${expectedColumn.name}`);
        continue;
      }
      if (actual.isNullable !== (expectedColumn.nullable ? "YES" : "NO")) {
        failures.push(`Column ${table.tableName}.${expectedColumn.name} nullability expected ${expectedColumn.nullable ? "YES" : "NO"}, found ${actual.isNullable}`);
      }
      if (!(expectedColumn.dataTypeHint.toLowerCase() === "json" && ["json", "longtext"].includes(actual.dataType.toLowerCase())) && actual.dataType.toLowerCase() !== expectedColumn.dataTypeHint.toLowerCase()) {
        failures.push(`Column ${table.tableName}.${expectedColumn.name} type expected ${expectedColumn.dataTypeHint}, found ${actual.dataType}`);
      }
      if (expectedColumn.generated && !actual.extra.toLowerCase().includes("generated")) {
        failures.push(`Column ${table.tableName}.${expectedColumn.name} should be generated, found extra '${actual.extra}'`);
      }
    }

    for (const expectedIndex of expectedIndexesFor(table)) {
      const actual = actualIndexMap.get(`${table.tableName}.${expectedIndex.name}`);
      if (!actual) {
        failures.push(`Missing index ${table.tableName}.${expectedIndex.name}`);
        continue;
      }
      if (Boolean(actual.nonUnique) === expectedIndex.unique) {
        failures.push(`Index ${table.tableName}.${expectedIndex.name} uniqueness mismatch`);
      }
      if (actual.columns !== expectedIndex.columns.join(",")) {
        failures.push(`Index ${table.tableName}.${expectedIndex.name} columns expected ${expectedIndex.columns.join(",")}, found ${actual.columns}`);
      }
    }

    for (const expectedForeignKey of expectedForeignKeysFor(table)) {
      const actual = actualForeignKeyMap.get(`${table.tableName}.${expectedForeignKey.name}`);
      if (!actual) {
        failures.push(`Missing FK ${table.tableName}.${expectedForeignKey.name}`);
        continue;
      }
      if (actual.columnName !== expectedForeignKey.column || actual.referencedTableName !== expectedForeignKey.referencedTable) {
        failures.push(`FK ${table.tableName}.${expectedForeignKey.name} reference mismatch`);
      }
      if (actual.deleteRule !== expectedForeignKey.deleteRule || actual.updateRule !== expectedForeignKey.updateRule) {
        failures.push(`FK ${table.tableName}.${expectedForeignKey.name} actions expected DELETE ${expectedForeignKey.deleteRule} UPDATE ${expectedForeignKey.updateRule}, found DELETE ${actual.deleteRule} UPDATE ${actual.updateRule}`);
      }
    }

    for (const expectedCheck of expectedChecksFor(table)) {
      if (!actualCheckNames.has(expectedCheck.name)) {
        failures.push(`Missing check constraint ${expectedCheck.name}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}


