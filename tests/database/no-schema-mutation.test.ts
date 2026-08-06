import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceFilesToScan = [
  "src/database/index.ts",
  "src/database/associations.ts",
  "src/database/tables/index.ts",
  "src/server.ts"
];

describe("database initialization schema-mutation guard", () => {
  it("does not contain sequelize sync calls in bootstrap sources", () => {
    for (const file of sourceFilesToScan) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/\.sync\s*\(/u);
      expect(source).not.toContain("sync({ alter: true })");
      expect(source).not.toContain("sync({ force: true })");
    }
  });
});