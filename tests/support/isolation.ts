import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { QueryTypes } from "sequelize";

import { sequelize } from "../../src/database/index.js";
import { describeSqlFailure, lockSnapshot } from "./db-diagnostics.js";

// Per-file isolation for the shared test database (setupFiles, runs before every
// test file).
//
// Root cause this addresses: every file shares one database and the files run
// sequentially, but rows left by an earlier file (or by a failed cleanup) break
// later files' fixtures and cleanup with unique-key, foreign-key and blank
// driver errors. Each file now starts and ends with every business table empty.
// Schema, migration metadata, the id sequences and seeder metadata are kept.

const KEPT_TABLES = new Set(["sequelizemeta", "sequelizeseedmeta", "id_sequences"]);

async function truncateBusinessTables(): Promise<void> {
  const rows = await sequelize.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()", {
    type: QueryTypes.SELECT,
  });
  const tables = rows.map((row) => row.t).filter((t) => !KEPT_TABLES.has(t.toLowerCase()));
  // One pinned connection: FOREIGN_KEY_CHECKS is a session variable.
  await sequelize.transaction(async (transaction) => {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0", { transaction });
    try {
      for (const table of tables) {
        await sequelize.query(`TRUNCATE TABLE \`${table}\``, { transaction });
      }
    } finally {
      await sequelize.query("SET FOREIGN_KEY_CHECKS = 1", { transaction });
    }
  });
}

function currentFile(taskFile: { filepath?: string } | undefined): string | null {
  return taskFile?.filepath ? taskFile.filepath.split(/mypetmart-backend[\\/]/u).pop() ?? taskFile.filepath : null;
}

beforeAll(async () => {
  // Start every file with the original environment (a previous file whose cleanup
  // threw may never have reached its own unstub).
  vi.unstubAllEnvs();
  try {
    await truncateBusinessTables();
  } catch (error) {
    const diagnostic = describeSqlFailure(error, { file: process.env.VITEST_WORKER_ID ? "worker" : null, test: null, phase: "file-setup-truncate" });
    console.error("[db-diagnostic]", JSON.stringify({ ...diagnostic, ...(await lockSnapshot(sequelize)) }));
    throw error;
  }
}, 120_000);

afterAll(async () => {
  try {
    await truncateBusinessTables();
  } catch (error) {
    const diagnostic = describeSqlFailure(error, { file: null, test: null, phase: "file-teardown-truncate" });
    console.error("[db-diagnostic]", JSON.stringify({ ...diagnostic, ...(await lockSnapshot(sequelize)) }));
  }
}, 120_000);

// Diagnostics for every SQL failure inside a test or hook: driver code, errno,
// SQL state, lock-wait counts and the file/test name. No SQL text or values.
afterEach(async (context) => {
  const task = (context as unknown as { task?: { name?: string; file?: { filepath?: string }; result?: { errors?: unknown[] } } }).task;
  const errors = task?.result?.errors ?? [];
  for (const error of errors) {
    const diagnostic = describeSqlFailure(error, { file: currentFile(task?.file), test: task?.name ?? null, phase: "test" });
    if (diagnostic) {
      console.error("[db-diagnostic]", JSON.stringify({ ...diagnostic, ...(await lockSnapshot(sequelize)) }));
    }
  }
});

// External-network guard for tests. Several clients (PayU verify/refund, iThink
// serviceability and tracking) call fetch() with no timeout, and the developer .env can
// carry sandbox credentials, so a test can reach a real provider. A stalled response
// then freezes the whole run (observed twice: 40+ minutes in the refund tests and in
// the COD tests, with no open DB transaction). Give every non-local fetch made during
// tests a bounded abort signal so a stall fails visibly instead of hanging. Production
// code is untouched; local requests (supertest talks to an in-process server) are not
// affected.
const EXTERNAL_FETCH_TIMEOUT_MS = 20_000;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/u.test(url);
  if (!isLocal && !init?.signal) {
    return realFetch(input, { ...init, signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) });
  }
  return realFetch(input, init);
}) as typeof fetch;
