import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/sessions.js", () => ({
  findSession: vi.fn(), createSession: vi.fn(), upsertUser: vi.fn(), deleteSession: vi.fn(), purgeExpiredSessions: vi.fn(),
}));
vi.mock("../slack/service.js", () => ({
  saveWebhook: vi.fn(), getWebhookForUser: vi.fn(), getWebhookForRepo: vi.fn(), deleteWebhook: vi.fn(), isConfigured: vi.fn(),
}));
vi.mock("../slack/client.js", async (orig) => ({ ...(await orig<typeof import("../slack/client.js")>()), sendSlack: vi.fn() }));

import { createApp } from "../app.js";
import * as sessions from "../auth/sessions.js";
import * as client from "../slack/client.js";
import * as slack from "../slack/service.js";
import { ActionError } from "../worker/types.js";

// Assembled at runtime so no secret-shaped literal sits in the source (GitHub push protection flags those).
const GOOD = ["https://hooks.slack", ".com/services/", "T00000000/", "B00000000/", "X".repeat(24)].join("");
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
});
const call = (method: string, path: string, body?: unknown, csrf: string | null = "csrf") =>
  fetch(`${base}/api/settings${path}`, {
    method,
    headers: { cookie: "sid=v", "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("slack settings", () => {
  it("requires login", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(null);
    expect((await call("GET", "/slack")).status).toBe(401);
  });
  it("only reports whether Slack is configured, never the URL", async () => {
    vi.mocked(slack.isConfigured).mockResolvedValue(true);
    const body = await (await call("GET", "/slack")).json();
    expect(body).toEqual({ configured: true });
    expect(slack.getWebhookForUser).not.toHaveBeenCalled();
  });
  it("saves a valid URL for the logged-in user only", async () => {
    const res = await call("PUT", "/slack", { webhookUrl: GOOD });
    expect(res.status).toBe(200);
    expect(slack.saveWebhook).toHaveBeenCalledWith(1, GOOD);
    expect(JSON.stringify(await res.json())).not.toContain("hooks.slack.com"); // not echoed back
  });
  it.each([["https://evil.com/x"], ["http://localhost/services/a/b/c"], [""], [123 as never]])("rejects %j", async (u) => {
    expect((await call("PUT", "/slack", { webhookUrl: u })).status).toBe(400);
    expect(slack.saveWebhook).not.toHaveBeenCalled();
  });
  it("needs CSRF to save, delete or test", async () => {
    expect((await call("PUT", "/slack", { webhookUrl: GOOD }, null)).status).toBe(403);
    expect((await call("DELETE", "/slack", undefined, null)).status).toBe(403);
    expect((await call("POST", "/slack/test", undefined, null)).status).toBe(403);
    expect(slack.saveWebhook).not.toHaveBeenCalled();
  });
  it("deletes", async () => {
    expect((await call("DELETE", "/slack")).status).toBe(200);
    expect(slack.deleteWebhook).toHaveBeenCalledWith(1);
  });
  it("test message: needs a saved URL", async () => {
    vi.mocked(slack.getWebhookForUser).mockResolvedValue(null);
    expect((await call("POST", "/slack/test")).status).toBe(400);
  });
  it("test message: sends and reports success", async () => {
    vi.mocked(slack.getWebhookForUser).mockResolvedValue(GOOD);
    vi.mocked(client.sendSlack).mockResolvedValue(undefined);
    expect(await (await call("POST", "/slack/test")).json()).toEqual({ ok: true });
  });
  it("test message: reports failure without leaking the URL", async () => {
    vi.mocked(slack.getWebhookForUser).mockResolvedValue(GOOD);
    vi.mocked(client.sendSlack).mockRejectedValue(new ActionError("Slack responded HTTP 404", false));
    const res = await call("POST", "/slack/test");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("hooks.slack.com");
  });
});
