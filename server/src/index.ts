import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";

const app = createApp();
app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});
