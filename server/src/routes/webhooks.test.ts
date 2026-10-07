import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../webhooks/service.js", () => ({
  findActiveRepo: vi.fn(), insertEvent: vi.fn(), upsertInstallationFromEvent: vi.fn(),
  deleteInstallation: vi.fn(), setSuspended: vi.fn(), removeRepos: vi.fn(),
}));

import { createApp } from "../app.js";
import { config } from "../config.js";
import * as svc from "../webhooks/service.js";

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
  vi.mocked(svc.findActiveRepo).mockResolvedValue({ id: 42 });
  vi.mocked(svc.insertEvent).mockResolvedValue(7);
});

const DELIVERY = "11111111-2222-3333-4444-555555555555";
const sign = (raw: string, secret = config.GITHUB_WEBHOOK_SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

interface Opts { event?: string; delivery?: string | null; signature?: string | null; contentType?: string; secret?: string }
function send(payload: unknown, o: Opts = {}) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": o.contentType ?? "application/json" };
  headers["x-github-event"] = o.event ?? "issues";
  if (o.delivery !== null) headers["x-github-delivery"] = o.delivery ?? DELIVERY;
  if (o.signature !== null) headers["x-hub-signature-256"] = o.signature ?? sign(raw, o.secret);
  return fetch(`${base}/webhooks/github`, { method: "POST", headers, body: raw });
}

const issuePayload = (over: Record<string, unknown> = {}) => ({
  action: "opened",
  issue: { number: 5, title: "Login bug", body: "it crashes", html_url: "https://github.com/me/app/issues/5", user: { login: "alice" }, labels: [] },
  repository: { id: 42, full_name: "me/app" },
  sender: { login: "alice" },
  installation: { id: 10 },
  ...over,
});
const prPayload = (over: Record<string, unknown> = {}) => ({
  action: "opened",
  pull_request: {
    number: 9, title: "Add feature", body: null, html_url: "https://github.com/me/app/pull/9",
    user: { login: "bob" }, labels: [{ name: "wip" }], base: { ref: "main" }, head: { ref: "feat" }, draft: false,
  },
  repository: { id: 42, full_name: "me/app" }, sender: { login: "bob" }, installation: { id: 10 }, ...over,
});
const pushPayload = (over: Record<string, unknown> = {}) => ({
  ref: "refs/heads/main", before: "a".repeat(40), after: "b".repeat(40), deleted: false, forced: false,
  compare: "https://github.com/me/app/compare/a...b",
  commits: [{ id: "b".repeat(40), message: "fix: thing\n\nlong body", author: { name: "Carol" } }],
  head_commit: { id: "b".repeat(40), message: "fix: thing\n\nlong body" },
  repository: { id: 42, full_name: "me/app" }, sender: { login: "carol" }, installation: { id: 10 }, ...over,
});

describe("authenticity", () => {
  it("rejects a request with no signature", async () => {
    expect((await send(issuePayload(), { signature: null })).status).toBe(401);
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("rejects a forged signature (wrong secret)", async () => {
    expect((await send(issuePayload(), { secret: "attacker" })).status).toBe(401);
    expect(svc.findActiveRepo).not.toHaveBeenCalled();
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("rejects a body modified after signing", async () => {
    const signed = sign(JSON.stringify(issuePayload()));
    const res = await send(issuePayload({ action: "reopened" }), { signature: signed });
    expect(res.status).toBe(401);
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("rejects non-JSON content types", async () => {
    expect((await send("payload=x", { contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
  });
  it("rejects malformed JSON even if correctly signed", async () => {
    expect((await send("{not json")).status).toBe(400);
  });
  it("rejects a missing or malformed delivery id", async () => {
    expect((await send(issuePayload(), { delivery: null })).status).toBe(400);
    expect((await send(issuePayload(), { delivery: "x'; DROP TABLE events;--" })).status).toBe(400);
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("answers ping", async () => {
    const res = await send({ zen: "Keep it logically awesome." }, { event: "ping" });
    expect(await res.json()).toEqual({ status: "pong" });
  });
});

describe("recording events", () => {
  it("stores an issue event with normalized fields", async () => {
    const res = await send(issuePayload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "accepted", id: 7 });
    expect(svc.insertEvent).toHaveBeenCalledWith(
      DELIVERY,
      expect.objectContaining({
        repoId: 42, eventType: "issues", action: "opened", title: "Login bug", author: "alice",
        url: "https://github.com/me/app/issues/5", installationId: 10,
        payload: expect.objectContaining({ number: 5, body: "it crashes", labels: [] }),
      }),
    );
  });
  it("stores a pull_request event", async () => {
    const res = await send(prPayload(), { event: "pull_request" });
    expect(res.status).toBe(200);
    expect(svc.insertEvent).toHaveBeenCalledWith(
      DELIVERY,
      expect.objectContaining({
        eventType: "pull_request", title: "Add feature", author: "bob",
        payload: expect.objectContaining({ number: 9, base: "main", head: "feat", labels: ["wip"], body: "" }),
      }),
    );
  });
  it("stores a push event titled by the head commit's first line", async () => {
    const res = await send(pushPayload(), { event: "push" });
    expect(res.status).toBe(200);
    expect(svc.insertEvent).toHaveBeenCalledWith(
      DELIVERY,
      expect.objectContaining({
        eventType: "push", action: null, title: "fix: thing", author: "carol",
        payload: expect.objectContaining({ branch: "main", commitCount: 1 }),
      }),
    );
  });
  it("clips oversized text before storing", async () => {
    const p = issuePayload();
    (p.issue as { body: string }).body = "x".repeat(50_000);
    await send(p);
    const stored = vi.mocked(svc.insertEvent).mock.calls[0]![1];
    expect((stored.payload.body as string).length).toBe(4000);
  });
});

describe("idempotency (duplicate / replayed deliveries)", () => {
  it("treats an already-stored delivery id as a harmless duplicate", async () => {
    vi.mocked(svc.insertEvent).mockResolvedValue(null);
    const res = await send(issuePayload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "duplicate" });
  });
});

describe("ignored events", () => {
  it("ignores unsupported event types", async () => {
    const res = await send({ zen: "x" }, { event: "star" });
    expect(res.status).toBe(202);
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("ignores issue actions that could cause feedback loops (labeled/edited)", async () => {
    for (const action of ["labeled", "edited", "closed"]) {
      expect((await send(issuePayload({ action }))).status).toBe(202);
    }
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("ignores events caused by the bot itself", async () => {
    const res = await send(issuePayload({ sender: { login: `${config.GITHUB_APP_SLUG}[bot]` } }));
    expect(await res.json()).toMatchObject({ status: "ignored", reason: "bot sender" });
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("ignores repos that are not connected, paused, or suspended", async () => {
    vi.mocked(svc.findActiveRepo).mockResolvedValue(null);
    const res = await send(issuePayload());
    expect(await res.json()).toMatchObject({ status: "ignored", reason: "repo not connected" });
    expect(svc.insertEvent).not.toHaveBeenCalled();
  });
  it("ignores branch deletions", async () => {
    expect((await send(pushPayload({ deleted: true }), { event: "push" })).status).toBe(202);
  });
  it("ignores malformed payloads for known events", async () => {
    expect((await send({ action: "opened" })).status).toBe(202);
  });
});

describe("failure handling", () => {
  it("returns 503 (not 2xx) when the database is down, so GitHub marks it failed and it can be redelivered", async () => {
    vi.mocked(svc.insertEvent).mockRejectedValue(new Error("connection refused"));
    const res = await send(issuePayload());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily unavailable" });
  });
});

describe("installation lifecycle", () => {
  const inst = { id: 10, account: { login: "me", type: "User" }, repository_selection: "selected", suspended_at: null };
  it("removes data on uninstall", async () => {
    await send({ action: "deleted", installation: inst }, { event: "installation" });
    expect(svc.deleteInstallation).toHaveBeenCalledWith(10);
  });
  it("suspends and unsuspends", async () => {
    await send({ action: "suspend", installation: inst }, { event: "installation" });
    expect(svc.setSuspended).toHaveBeenCalledWith(10, true);
    await send({ action: "unsuspend", installation: inst }, { event: "installation" });
    expect(svc.setSuspended).toHaveBeenCalledWith(10, false);
  });
  it("disconnects repos removed from the installation", async () => {
    await send({ installation: { id: 10 }, repositories_removed: [{ id: 1 }, { id: 2 }] }, { event: "installation_repositories" });
    expect(svc.removeRepos).toHaveBeenCalledWith(10, [1, 2]);
  });
  it("still requires a valid signature", async () => {
    await send({ action: "deleted", installation: inst }, { event: "installation", secret: "attacker" });
    expect(svc.deleteInstallation).not.toHaveBeenCalled();
  });
});
