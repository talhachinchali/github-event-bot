import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { query } from "./db/index.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));

  // Liveness: cheap, no DB. Safe for keep-warm pings.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Readiness: verifies the database is reachable.
  app.get("/readyz", async (_req, res) => {
    try {
      await query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  return app;
}
