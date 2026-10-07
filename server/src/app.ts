import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { isProd } from "./config.js";
import { logger } from "./logger.js";
import { query } from "./db/index.js";
import { loadSession } from "./auth/middleware.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";

const WEB_DIST = path.resolve(import.meta.dirname, "../../web/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind Render's proxy: needed for correct client IPs (rate limiting) and secure cookies.
  if (isProd) app.set("trust proxy", 1);

  app.use(pinoHttp({ logger }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "https://avatars.githubusercontent.com"],
        },
      },
    }),
  );

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

  // Auth + API: never cache, parse cookies, resolve the session.
  const noStore = (_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    next();
  };
  app.use(["/auth", "/api"], noStore, cookieParser(), loadSession);
  app.use("/auth", authRouter);
  app.use("/api", express.json({ limit: "100kb" }), apiRouter);

  // Serve the built React app (production) with SPA fallback.
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(WEB_DIST, "index.html"));
    });
  }

  // Never leak internals to clients.
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    req.log.error({ err: err.message }, "unhandled error");
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
