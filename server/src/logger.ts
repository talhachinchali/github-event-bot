import { pino } from "pino";
import { config } from "./config.js";

// Redact anything that could carry a secret, even if someone logs it by accident.
export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-hub-signature-256"]',
      'res.headers["set-cookie"]',
      "*.token",
      "*.secret",
      "*.password",
      "*.privateKey",
      "*.webhookUrl",
    ],
    censor: "[redacted]",
  },
  transport:
    config.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
});
