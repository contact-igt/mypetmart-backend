import { QueryTypes, type Sequelize } from "sequelize";

// Test-only diagnostics for database failures. Logs ONLY driver codes, errno,
// SQL state, a redacted message, the file/test name, and lock-wait counts.
// Never logs SQL text, bound parameter values, credentials, or row contents.

export type SqlFailureDiagnostic = {
  kind: "sql_failure";
  name: string | null;
  code: string | null;
  errno: number | null;
  sqlState: string | null;
  message: string | null;
  file: string | null;
  test: string | null;
  phase: string;
};

type DriverErrorLike = { code?: unknown; errno?: unknown; sqlState?: unknown; sqlMessage?: unknown; message?: unknown; name?: unknown };

function asDriverError(error: unknown): DriverErrorLike | null {
  if (!error || typeof error !== "object") return null;
  const candidates: unknown[] = [error, (error as { parent?: unknown }).parent, (error as { original?: unknown }).original];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && ("code" in candidate || "errno" in candidate || "sqlState" in candidate)) {
      return candidate;
    }
  }
  return error;
}

/** Redacts bound values from duplicate-key style messages before they are logged. */
function redact(message: string): string {
  return message.replace(/Duplicate entry '[^']*'/u, "Duplicate entry '<redacted>'").slice(0, 300);
}

export function describeSqlFailure(error: unknown, context: { file: string | null; test: string | null; phase: string }): SqlFailureDiagnostic | null {
  const driver = asDriverError(error);
  const code = typeof driver?.code === "string" ? driver.code : null;
  const isSqlFailure = code !== null || typeof driver?.errno === "number" || typeof driver?.sqlState === "string" || (error instanceof Error && error.name.startsWith("Sequelize"));
  if (!isSqlFailure) return null;
  const rawMessage = typeof driver?.sqlMessage === "string" ? driver.sqlMessage : typeof driver?.message === "string" ? driver.message : null;
  return {
    kind: "sql_failure",
    name: error instanceof Error ? error.name : null,
    code,
    errno: typeof driver?.errno === "number" ? driver.errno : null,
    sqlState: typeof driver?.sqlState === "string" ? driver.sqlState : null,
    message: rawMessage ? redact(rawMessage) : rawMessage === null && code === null ? "(driver error without a message)" : null,
    file: context.file,
    test: context.test,
    phase: context.phase,
  };
}

/** Snapshot of lock waits and open transactions at the moment of a failure. */
export async function lockSnapshot(sequelize: Sequelize): Promise<Record<string, unknown>> {
  try {
    const [row] = await sequelize.query<{ waiters: number; maxWaitSeconds: number | null; openTransactions: number }>(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT') AS waiters,
         (SELECT MAX(TIMESTAMPDIFF(SECOND, trx_wait_started, NOW())) FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT') AS maxWaitSeconds,
         (SELECT COUNT(*) FROM information_schema.innodb_trx) AS openTransactions`,
      { type: QueryTypes.SELECT }
    );
    return { lockWaiters: Number(row?.waiters ?? 0), maxLockWaitSeconds: row?.maxWaitSeconds ?? null, openTransactions: Number(row?.openTransactions ?? 0) };
  } catch {
    return { lockSnapshot: "unavailable" };
  }
}
