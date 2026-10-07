import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isProd } from "../config.js";
import { logger } from "../logger.js";
import { randomToken, safeEqual } from "../auth/crypto.js";
import { authorizeUrl, exchangeCode, fetchGitHubUser } from "../auth/github-oauth.js";
import { SESSION_COOKIE, requireAuth, requireCsrf } from "../auth/middleware.js";
import { createSession, deleteSession, upsertUser } from "../auth/sessions.js";

const TX_COOKIE = "oauth_tx";
// Lax is required: the callback is a cross-site top-level GET navigation coming back from github.com.
const cookieBase = { httpOnly: true, secure: isProd, sameSite: "lax" as const };

export const authRouter = Router();

// Brute-force / abuse guard for the login endpoints.
authRouter.use(rateLimit({ windowMs: 5 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));

// 1. Start login: remember a random `state` + PKCE verifier in a short-lived cookie, send user to GitHub.
authRouter.get("/github/login", (_req, res) => {
  const state = randomToken();
  const verifier = randomToken(48);
  res.cookie(TX_COOKIE, `${state}.${verifier}`, { ...cookieBase, path: "/auth", maxAge: 10 * 60_000 });
  res.redirect(authorizeUrl(state, verifier));
});

// 2. GitHub redirects back here with ?code&state.
authRouter.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const tx = typeof req.cookies?.[TX_COOKIE] === "string" ? (req.cookies[TX_COOKIE] as string) : "";
  const [expectedState, verifier] = tx.split(".");
  res.clearCookie(TX_COOKIE, { ...cookieBase, path: "/auth" }); // single use

  const fail = (reason: string) => {
    logger.warn({ reason }, "github login failed");
    res.redirect("/?error=login_failed");
  };

  if (typeof code !== "string" || typeof state !== "string" || !expectedState || !verifier) {
    return fail("missing_params");
  }
  // CSRF protection for the OAuth flow: state must match what we put in this browser's cookie.
  if (!safeEqual(state, expectedState)) return fail("state_mismatch");

  try {
    const { accessToken, expiresIn } = await exchangeCode(code, verifier);
    const ghUser = await fetchGitHubUser(accessToken);
    await upsertUser(ghUser);
    const session = await createSession({ userId: ghUser.id, ghToken: accessToken, tokenTtlSeconds: expiresIn });
    res.cookie(SESSION_COOKIE, session.token, { ...cookieBase, path: "/", maxAge: session.maxAgeMs });
    logger.info({ userId: ghUser.id, login: ghUser.login }, "user logged in");
    res.redirect("/");
  } catch (err) {
    fail((err as Error).message);
  }
});

authRouter.post("/logout", requireAuth, requireCsrf, async (req, res) => {
  await deleteSession(req.auth!.sessionId);
  res.clearCookie(SESSION_COOKIE, { ...cookieBase, path: "/" });
  res.status(204).end();
});
