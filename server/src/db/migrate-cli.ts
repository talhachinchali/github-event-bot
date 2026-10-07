import { runMigrations } from "./migrate.js";
import { closePool } from "./index.js";
import { logger } from "../logger.js";

try {
  const applied = await runMigrations();
  logger.info({ applied }, applied.length ? "migrations complete" : "database already up to date");
} catch (err) {
  logger.error({ err: (err as Error).message }, "migration failed");
  process.exitCode = 1;
} finally {
  await closePool();
}
