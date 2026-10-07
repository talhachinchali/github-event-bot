import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/sessions.js", () => ({
  findSession: vi.fn(),
  createSession: vi.fn(),
  upsertUser: vi.fn(),
  deleteSession: vi.fn(),
  purgeExpiredSessions: vi.fn(),
}));
vi.mock("../auth/github-oauth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/github-oauth.js")>()),
  exchangeCode: vi.fn(),
  fetchGitHubUser: vi.fn(),
}));

import { createApp } from "../app.js";
import * as sessions from "../auth/sessions.js";
import * as oauth from "../auth/github-oauth.js";

const authCtx = {
  sessionId: "sess1",
  csrfToken: "csrf-secret",
  ghTokenEnc: null, expiresAt: new Date(Date.now() + 3_600_000),
  user: { id: 1, login: "octocat", name: "Octo", avatarUrl: null },
};

let server: Server;
let base: string;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  vi.resetAllMocks();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { redirect: "manual", headers });

describe("/api auth", () => {
  it("rejects requests without a session", async () => {
    const res = await get("/api/me");
    expect(res.status).toBe(401);
  });
  it("rejects an unknown/expired session cookie", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(null);
    const res = await get("/api/me", { cookie: "sid=nope" });
    expect(res.status).toBe(401);
  });
  it("returns the user and csrf token for a valid session, uncached", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(authCtx);
    const res = await get("/api/me", { cookie: "sid=valid" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.user.login).toBe("octocat");
    expect(body.csrfToken).toBe("csrf-secret");
  });
});

describe("CSRF on mutating routes", () => {
  const logout = (headers: Record<string, string>) =>
    fetch(base + "/auth/logout", { method: "POST", headers: { cookie: "sid=valid", ...headers } });

  it("blocks logout without a csrf header", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(authCtx);
    expect((await logout({})).status).toBe(403);
    expect(sessions.deleteSession).not.toHaveBeenCalled();
  });
  it("blocks logout with a wrong csrf header", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(authCtx);
    expect((await logout({ "x-csrf-token": "wrong" })).status).toBe(403);
  });
  it("allows logout with the right csrf header", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(authCtx);
    expect((await logout({ "x-csrf-token": "csrf-secret" })).status).toBe(204);
    expect(sessions.deleteSession).toHaveBeenCalledWith("sess1");
  });
});

describe("GitHub OAuth flow", () => {
  async function startLogin() {
    const res = await get("/auth/github/login");
    const location = new URL(res.headers.get("location")!);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("oauth_tx="))!;
    return { res, location, cookie, txValue: cookie.split(";")[0]! };
  }

  it("redirects to GitHub with state + PKCE and sets an HttpOnly tx cookie", async () => {
    const { res, location, cookie } = await startLogin();
    expect(res.status).toBe(302);
    expect(location.host).toBe("github.com");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("rejects a callback whose state does not match (forged/CSRF)", async () => {
    const { txValue } = await startLogin();
    const res = await get("/auth/github/callback?code=abc&state=attacker", { cookie: txValue });
    expect(res.headers.get("location")).toBe("/?error=login_failed");
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it("rejects a callback with no transaction cookie", async () => {
    const res = await get("/auth/github/callback?code=abc&state=whatever");
    expect(res.headers.get("location")).toBe("/?error=login_failed");
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
  });

  it("completes login with a matching state and sets the session cookie", async () => {
    const { location, txValue } = await startLogin();
    vi.mocked(oauth.exchangeCode).mockResolvedValue({ accessToken: "ghu_x", expiresIn: 28800 });
    vi.mocked(oauth.fetchGitHubUser).mockResolvedValue({ id: 1, login: "octocat", name: null, avatar_url: null });
    vi.mocked(sessions.createSession).mockResolvedValue({ token: "TOKEN", maxAgeMs: 28_800_000, expiresAt: new Date() });

    const state = location.searchParams.get("state")!;
    const res = await get(`/auth/github/callback?code=abc&state=${state}`, { cookie: txValue });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const sid = res.headers.getSetCookie().find((c) => c.startsWith("sid="))!;
    expect(sid).toContain("sid=TOKEN");
    expect(sid).toMatch(/HttpOnly/i);
    // PKCE verifier from the cookie is forwarded to the token exchange.
    expect(oauth.exchangeCode).toHaveBeenCalledWith("abc", txValue.split("=")[1]!.split(".")[1]);
    // The GitHub token never reaches the browser.
    expect(res.headers.getSetCookie().join(";")).not.toContain("ghu_x");
  });

  it("shows a generic error if the token exchange fails", async () => {
    const { location, txValue } = await startLogin();
    vi.mocked(oauth.exchangeCode).mockRejectedValue(new Error("token exchange rejected: bad_verification_code"));
    const state = location.searchParams.get("state")!;
    const res = await get(`/auth/github/callback?code=abc&state=${state}`, { cookie: txValue });
    expect(res.headers.get("location")).toBe("/?error=login_failed");
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
});
