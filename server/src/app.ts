import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
