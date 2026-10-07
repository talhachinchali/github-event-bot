import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { closePool } from "./db/index.js";
import { startReconciler } from "./github/reconciler.js";
import { purgeOldEvents } from "./events/service.js";
import { createWorker } from "./worker/index.js";

// Apply pending migrations before accepting traffic (idempotent, advisory-locked).
await runMigrations();

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});

// Starts by claiming anything left pending/failed/stale from before a restart, so nothing is lost.
const worker = createWorker();
worker.start();

// Ask GitHub to resend webhooks that failed while we were down/asleep (it never retries by itself).
startReconciler();

// Graceful shutdown (deploys): stop taking requests, let the in-flight event finish, then close the DB.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  server.close();
  await worker.stop();
  await closePool();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Housekeeping, hourly: drop expired sessions and events older than 30 days (keeps the free database small).
// The first run waits an hour so a restart never touches the database needlessly.
setInterval(() => {
  purgeExpiredSessions().catch((err) => logger.warn({ err: err.message }, "session purge failed"));
  purgeOldEvents(30).catch((err) => logger.warn({ err: err.message }, "event purge failed"));
}, 3_600_000).unref();
