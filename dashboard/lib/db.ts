import { Pool, type QueryResultRow } from "pg";

declare global {
  var dashboardPool: Pool | undefined;
}

function createPool() {
  const required = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing database configuration: ${missing.join(", ")}`);
  const port = Number(process.env.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PGPORT must be a valid TCP port");
  return new Pool({
    host: process.env.PGHOST,
    port,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS || 5_000),
    application_name: "faizan_job_dashboard",
    options: "-c default_transaction_read_only=on -c statement_timeout=5000",
  });
}

function getPool() {
  if (!global.dashboardPool) global.dashboardPool = createPool();
  return global.dashboardPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return (await getPool().query<T>(text, values)).rows;
}

export async function safeQuery<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  try {
    return { data: await query<T>(text, values), error: null };
  } catch (error) {
    console.error("Dashboard query failed", error instanceof Error ? error.message : "Unknown database error");
    return { data: [] as T[], error: "This section is temporarily unavailable." };
  }
}
