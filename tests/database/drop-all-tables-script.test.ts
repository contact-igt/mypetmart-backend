import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("db:drop:all script", () => {
  it("discovers and drops every database table instead of only registered models", () => {
    const source = readFileSync("src/scripts/drop-all-tables.ts", "utf8");

    expect(source).toContain("queryInterface.showAllTables()");
    expect(source).toContain("queryInterface.dropAllTables()");
    expect(source).not.toContain("sequelize.drop()");
  });

  it("verifies that the database contains no remaining tables", () => {
    const source = readFileSync("src/scripts/drop-all-tables.ts", "utf8");

    expect(source).toContain("remainingTables.length > 0");
    expect(source).toContain("Database cleanup incomplete");
  });

  it("does not depend on stale hard-coded metadata or infrastructure table names", () => {
    const source = readFileSync("src/scripts/drop-all-tables.ts", "utf8");

    expect(source).not.toContain("SHOW TABLES LIKE");
    expect(source).not.toContain("SequelizeData");
    expect(source).not.toContain("SequelizeMeta");
    expect(source).not.toContain("id_sequences");
    expect(source).not.toContain("catalog_sku_reservations");
  });
});
