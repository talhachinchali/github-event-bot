import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { purgeExpiredSessions } from "./auth/sessions.js";

// Apply pending migrations before accepting traffic (idempotent, advisory-locked).
await runMigrations();

const app = createApp();
app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});

// Housekeeping: drop expired sessions hourly.
setInterval(
  () => purgeExpiredSessions().catch((err) => logger.warn({ err: err.message }, "session purge failed")),
  3_600_000,
).unref();
