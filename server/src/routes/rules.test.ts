import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/sessions.js", () => ({
  findSession: vi.fn(), createSession: vi.fn(), upsertUser: vi.fn(), deleteSession: vi.fn(), purgeExpiredSessions: vi.fn(),
}));
vi.mock("../repos/service.js", async (orig) => ({ ...(await orig<typeof import("../repos/service.js")>()), isRepoOwner: vi.fn() }));
vi.mock("../rules/service.js", async (orig) => ({
  ...(await orig<typeof import("../rules/service.js")>()),
  listRules: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn(),
}));

import { createApp } from "../app.js";
import * as sessions from "../auth/sessions.js";
import * as repos from "../repos/service.js";
import * as rules from "../rules/service.js";

const valid = {
  name: "bugs", eventType: "issues",
  conditions: [{ field: "title", op: "contains", value: "bug" }],
  actions: [{ type: "add_label", label: "bug" }, { type: "slack" }],
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
  vi.mocked(sessions.findSession).mockResolvedValue({
    sessionId: "s", csrfToken: "csrf", ghTokenEnc: null, expiresAt: new Date(Date.now() + 3_600_000), user: { id: 1, login: "me", name: null, avatarUrl: null },
  });
  vi.mocked(repos.isRepoOwner).mockResolvedValue(true);
});

const call = (method: string, path: string, body?: unknown, csrf: string | null = "csrf") =>
  fetch(`${base}/api/repos${path}`, {
    method,
    headers: { cookie: "sid=v", "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("rules API authorization", () => {
  it("requires login", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(null);
    expect((await call("GET", "/100/rules")).status).toBe(401);
  });
  it("404s for a repo the user does not own, for every verb, without touching rules", async () => {
    vi.mocked(repos.isRepoOwner).mockResolvedValue(false);
    expect((await call("GET", "/100/rules")).status).toBe(404);
    expect((await call("POST", "/100/rules", valid)).status).toBe(404);
    expect((await call("PUT", "/100/rules/5", valid)).status).toBe(404);
    expect((await call("DELETE", "/100/rules/5")).status).toBe(404);
    expect(rules.listRules).not.toHaveBeenCalled();
    expect(rules.createRule).not.toHaveBeenCalled();
    expect(rules.updateRule).not.toHaveBeenCalled();
    expect(rules.deleteRule).not.toHaveBeenCalled();
    expect(repos.isRepoOwner).toHaveBeenCalledWith(1, 100);
  });
  it("requires CSRF on writes", async () => {
    expect((await call("POST", "/100/rules", valid, null)).status).toBe(403);
    expect((await call("DELETE", "/100/rules/5", undefined, null)).status).toBe(403);
    expect(rules.createRule).not.toHaveBeenCalled();
  });
  it("rejects a non-numeric repo id", async () => {
    expect((await call("GET", "/abc/rules")).status).toBe(400);
  });
});

describe("rules API behaviour", () => {
  it("lists rules", async () => {
    vi.mocked(rules.listRules).mockResolvedValue([]);
    const res = await call("GET", "/100/rules");
    expect(await res.json()).toEqual({ rules: [] });
    expect(rules.listRules).toHaveBeenCalledWith(100);
  });
  it("creates a valid rule scoped to the URL's repo", async () => {
    vi.mocked(rules.createRule).mockResolvedValue({ id: 1, repoId: 100, createdAt: new Date(), enabled: true, useAi: false, ...valid } as never);
    const res = await call("POST", "/100/rules", valid);
    expect(res.status).toBe(201);
    expect(rules.createRule).toHaveBeenCalledWith(100, expect.objectContaining({ name: "bugs", enabled: true }));
  });
  it("rejects invalid rules with details and stores nothing", async () => {
    const res = await call("POST", "/100/rules", { ...valid, actions: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).issues.length).toBeGreaterThan(0);
    expect(rules.createRule).not.toHaveBeenCalled();
  });
  it("409 when the per-repo limit is hit", async () => {
    vi.mocked(rules.createRule).mockRejectedValue(new rules.RuleLimitError("at most 50 rules per repo"));
    expect((await call("POST", "/100/rules", valid)).status).toBe(409);
  });
  it("updates only within the repo; 404 if the rule is not in it", async () => {
    vi.mocked(rules.updateRule).mockResolvedValue(null);
    expect((await call("PUT", "/100/rules/999", valid)).status).toBe(404);
    expect(rules.updateRule).toHaveBeenCalledWith(100, 999, expect.any(Object));
  });
  it("deletes within the repo", async () => {
    vi.mocked(rules.deleteRule).mockResolvedValue(true);
    expect((await call("DELETE", "/100/rules/5")).status).toBe(200);
    expect(rules.deleteRule).toHaveBeenCalledWith(100, 5);
  });
});
