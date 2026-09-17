// Run after npm run build: node tests/database/migration-build.check.mjs
import assert from "node:assert/strict";
import { Umzug } from "umzug";
import { createMigrator } from "../../dist/database/migrations/migrator.js";
import { disconnectDatabase } from "../../dist/database/index.js";

try {
  let applied = [];
  const migrator = new Umzug({
    ...createMigrator().options,
    storage: {
      executed: async () => applied,
      logMigration: async () => {},
      unlogMigration: async () => {}
    }
  });
  const names = (await migrator.pending()).map(({ name }) => name);
  assert.ok(names.length > 0);
  assert.ok(names.every((name) => name.endsWith(".ts")));
  applied = names.filter((name) => !/^(067|068)-/u.test(name));
  assert.deepEqual((await migrator.executed()).map(({ name }) => name), applied);
  assert.deepEqual((await migrator.pending()).map(({ name }) => name), names.filter((name) => !applied.includes(name)));
  console.log("Compiled migrations recognize existing TypeScript migration records.");
} finally {
  await disconnectDatabase();
}
