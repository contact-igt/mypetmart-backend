import { connectDatabase, disconnectDatabase } from "../index.js";
import { verifySchema } from "../migrations/schema-verifier.js";

try {
  await connectDatabase();
  const result = await verifySchema({ expectEmpty: process.argv.includes("--expect-empty") });
  if (!result.ok) {
    console.error(JSON.stringify({ ok: result.ok, failures: result.failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, failures: [] }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
