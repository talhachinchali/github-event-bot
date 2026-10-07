import type { NextFunction, Request, Response } from "express";
import { isProd } from "../config.js";
import { safeEqual } from "./crypto.js";
import { findSession, type AuthContext } from "./sessions.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

// "__Host-" prefix (prod): browser enforces Secure + Path=/ + no Domain, so it can't be overwritten by a subdomain.
export const SESSION_COOKIE = isProd ? "__Host-sid" : "sid";

/** Attaches req.auth if the request carries a valid, unexpired session. Never rejects by itself. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0) {
      req.auth = (await findSession(token)) ?? undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Double-submit style check against the per-session token. Must run after requireAuth. */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const header = req.get("x-csrf-token");
  if (!req.auth || !header || !safeEqual(header, req.auth.csrfToken)) {
    res.status(403).json({ error: "invalid csrf token" });
    return;
  }
  next();
}
