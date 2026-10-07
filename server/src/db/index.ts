import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

// BIGINT (oid 20) comes back as string by default. GitHub ids fit in a JS safe integer.
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | undefined;

// pg already treats sslmode=require as verify-full (full certificate checks). Say so
// explicitly, which silences pg's deprecation warning and keeps behavior if pg v9 changes it.
function connectionString(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=verify-full");
}

export function getPool(): pg.Pool {
  if (!pool) {
    if (!config.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({
      connectionString: connectionString(config.DATABASE_URL),
      max: 5,
      // Opening a connection is the expensive part (TLS + auth, seconds across regions), so keep warm ones
      // around for a couple of minutes: a dashboard load fires several requests at once and should reuse them.
      idleTimeoutMillis: 120_000,
      keepAlive: true,
      // Neon scales to zero; the first connection after idle can take a few seconds.
      connectionTimeoutMillis: 15_000,
    });
    // An idle client erroring (e.g. Neon closing a connection) must not crash the process.
    pool.on("error", (err) => logger.warn({ err: err.message }, "idle pg client error"));
  }
  return pool;
}

export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}
