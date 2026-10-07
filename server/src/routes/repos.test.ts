import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/sessions.js", () => ({
  findSession: vi.fn(), createSession: vi.fn(), upsertUser: vi.fn(), deleteSession: vi.fn(), purgeExpiredSessions: vi.fn(),
}));
vi.mock("../github/user-api.js", async (orig) => ({
  ...(await orig<typeof import("../github/user-api.js")>()),
  listUserInstallations: vi.fn(),
  listInstallationRepos: vi.fn(),
}));
vi.mock("../repos/service.js", async (orig) => ({
  ...(await orig<typeof import("../repos/service.js")>()),
  upsertInstallation: vi.fn(), listConnected: vi.fn(), connectRepo: vi.fn(), setEnabled: vi.fn(), disconnectRepo: vi.fn(),
}));

import { createApp } from "../app.js";
import { encrypt } from "../auth/crypto.js";
import * as sessions from "../auth/sessions.js";
import * as gh from "../github/user-api.js";
import * as svc from "../repos/service.js";

const installation = { id: 10, account: { login: "me", type: "User" }, repository_selection: "selected", suspended_at: null };
const adminRepo = { id: 100, full_name: "me/app", private: false, permissions: { admin: true } };
const readOnlyRepo = { id: 101, full_name: "org/lib", private: true, permissions: { admin: false } };

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
  vi.mocked(sessions.findSession).mockResolvedValue({
    sessionId: "s", csrfToken: "csrf", ghTokenEnc: encrypt("ghu_token"),
    user: { id: 1, login: "me", name: null, avatarUrl: null },
  });
  vi.mocked(gh.listUserInstallations).mockResolvedValue([installation]);
  vi.mocked(gh.listInstallationRepos).mockResolvedValue([adminRepo, readOnlyRepo]);
  vi.mocked(svc.listConnected).mockResolvedValue([]);
});

const call = (method: string, path: string, body?: unknown, csrf: string | null = "csrf") =>
  fetch(base + "/api/repos" + path, {
    method,
    headers: {
      cookie: "sid=valid",
      "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("GET /api/repos", () => {
  it("requires login", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(null);
    expect((await call("GET", "")).status).toBe(401);
  });
  it("lists connectable repos and hides already-connected ones", async () => {
    vi.mocked(svc.listConnected).mockResolvedValue([
      { id: 100, installationId: 10, fullName: "me/app", enabled: true, createdAt: new Date() },
    ]);
    const body = await (await call("GET", "")).json();
    expect(body.connected).toHaveLength(1);
    expect(body.available).toEqual([
      { id: 101, fullName: "org/lib", private: true, installationId: 10, canConnect: false },
    ]);
    // uses the decrypted user token against GitHub
    expect(gh.listUserInstallations).toHaveBeenCalledWith("ghu_token");
  });
  it("asks the user to sign in again when GitHub rejects the token", async () => {
    vi.mocked(gh.listUserInstallations).mockRejectedValue(new gh.GitHubApiError(401, "bad credentials"));
    const res = await call("GET", "");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("github_token_expired");
  });
  it("returns 502 (not a stack trace) when GitHub is down", async () => {
    vi.mocked(gh.listUserInstallations).mockRejectedValue(new gh.GitHubApiError(503, "down"));
    const res = await call("GET", "");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });
});

describe("POST /api/repos (connect)", () => {
  it("needs the CSRF token", async () => {
    expect((await call("POST", "", { installationId: 10, repoId: 100 }, null)).status).toBe(403);
    expect(svc.connectRepo).not.toHaveBeenCalled();
  });
  it("validates the body", async () => {
    expect((await call("POST", "", { installationId: "x" })).status).toBe(400);
  });
  it("connects an admin repo, using GitHub's name (not the client's)", async () => {
    const res = await call("POST", "", { installationId: 10, repoId: 100 });
    expect(res.status).toBe(201);
    expect(svc.connectRepo).toHaveBeenCalledWith({ userId: 1, installationId: 10, repoId: 100, fullName: "me/app" });
  });
  it("refuses a repo the user is not admin of", async () => {
    expect((await call("POST", "", { installationId: 10, repoId: 101 })).status).toBe(403);
    expect(svc.connectRepo).not.toHaveBeenCalled();
  });
  it("refuses a repo that is not in the user's installation (forged id)", async () => {
    expect((await call("POST", "", { installationId: 10, repoId: 999 })).status).toBe(404);
    expect(svc.connectRepo).not.toHaveBeenCalled();
  });
  it("refuses an installation the user cannot access", async () => {
    expect((await call("POST", "", { installationId: 77, repoId: 100 })).status).toBe(404);
    expect(svc.connectRepo).not.toHaveBeenCalled();
  });
  it("returns 409 when another user already connected the repo", async () => {
    vi.mocked(svc.connectRepo).mockRejectedValue(new svc.RepoConflictError("taken"));
    expect((await call("POST", "", { installationId: 10, repoId: 100 })).status).toBe(409);
  });
});

describe("PATCH/DELETE /api/repos/:id", () => {
  it("scopes updates to the logged-in user", async () => {
    vi.mocked(svc.setEnabled).mockResolvedValue(true);
    expect((await call("PATCH", "/100", { enabled: false })).status).toBe(200);
    expect(svc.setEnabled).toHaveBeenCalledWith(1, 100, false);
  });
  it("returns 404 for a repo that is not yours", async () => {
    vi.mocked(svc.disconnectRepo).mockResolvedValue(false);
    expect((await call("DELETE", "/555")).status).toBe(404);
    expect(svc.disconnectRepo).toHaveBeenCalledWith(1, 555);
  });
  it("rejects non-numeric ids and missing CSRF", async () => {
    expect((await call("DELETE", "/abc")).status).toBe(400);
    expect((await call("DELETE", "/100", undefined, null)).status).toBe(403);
  });
});
