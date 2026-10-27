import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Sequelize } from "sequelize";
import { databaseConfig } from "../src/config/database.config.js";

// Only one test run may own the test database at a time. Every run DROPs and
// re-creates the database and re-runs all migrations, so two overlapping runs
// (e.g. an IDE run plus a CLI run) corrupt each other: "Table 'users' already
// exists" and FK/unique failures in unrelated files. A lock file (exclusive
// create, holds the owner PID) makes an overlapping run fail fast and clearly.
// A lock whose owner PID is no longer alive is stale and is taken over.
// A file lock is used instead of a held DB session, which measurably changed
// results for unrelated test files.
const LOCK_PATH = join(tmpdir(), "mypetmart-backend-test-run.lock");
// Longest plausible full-suite run. Older locks are stale regardless of PID.
const MAX_LOCK_AGE_MS = 2 * 60 * 60 * 1000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireRunLock(dbName: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const ownerPid = Number(readFileSync(LOCK_PATH, "utf8").trim());
      // A live PID is not proof of a live run: Windows reuses PIDs. A lock older than
      // the longest plausible run is treated as stale even when its PID answers.
      const ageMs = Date.now() - statSync(LOCK_PATH).mtimeMs;
      if (Number.isInteger(ownerPid) && ownerPid > 0 && processAlive(ownerPid) && ageMs < MAX_LOCK_AGE_MS) {
        throw new Error(
          `Another test run (pid ${ownerPid}) is already using the test database '${dbName}'. Wait for it to finish and run again. Overlapping runs corrupt each other's schema. If no run is active, delete ${LOCK_PATH}.`,
          { cause: error }
        );
      }
      unlinkSync(LOCK_PATH); // stale: owner is gone
    }
  }
  throw new Error(`Could not acquire the test run lock at ${LOCK_PATH}.`);
}

export default async function () {
  // 1. Guard check
  const env = process.env.NODE_ENV;
  if (env !== "test") {
    throw new Error(`Test database setup can only run when NODE_ENV is "test". Current: ${env}`);
  }

  // Derive test database name
  const dbName = process.env.DB_NAME || "mypetmart_test";
  if (!dbName.endsWith("_test")) {
    throw new Error(`Test database name must end with "_test". Current: ${dbName}`);
  }

  acquireRunLock(dbName);

  // Connect to MySQL server without selecting a database first
  const rootSequelize = new Sequelize("", databaseConfig.username, databaseConfig.password, {
    dialect: "mysql",
    host: databaseConfig.host,
    port: databaseConfig.port,
    logging: false
  });

  try {
    await rootSequelize.authenticate();
    // Every run starts from a deterministic isolated schema. The guard above
    // prevents this reset from ever targeting a non-test database.
    await rootSequelize.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await rootSequelize.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  } catch (error) {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
    throw error;
  } finally {
    await rootSequelize.close();
  }

  // Import sequelize and migrator to run migrations
  const { sequelize } = await import("../src/database/index.js");
  const { createMigrator } = await import("../src/database/migrations/migrator.js");

  // Run migrations on the test database
  const migrator = createMigrator(sequelize);
  await migrator.up();

  // Release the run lock only when the whole run has finished.
  return () => {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  };
}
