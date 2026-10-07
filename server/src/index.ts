import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";

// Apply pending migrations before accepting traffic (idempotent, advisory-locked).
await runMigrations();

const app = createApp();
app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});
