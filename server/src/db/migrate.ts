import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "./index.js";
import { logger } from "../logger.js";

// Resolves to server/migrations from both src/db (tsx) and dist/db (compiled).
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");
// Arbitrary constant: serializes concurrent migrators (e.g. two instances booting).
const LOCK_ID = 727_001;

export async function runMigrations(): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      logger.info({ migration: file }, "migration applied");
      applied.push(file);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}
