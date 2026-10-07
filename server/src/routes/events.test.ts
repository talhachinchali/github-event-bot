import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/sessions.js", () => ({
  findSession: vi.fn(), createSession: vi.fn(), upsertUser: vi.fn(), deleteSession: vi.fn(), purgeExpiredSessions: vi.fn(),
}));
vi.mock("../events/service.js", async (orig) => ({
  ...(await orig<typeof import("../events/service.js")>()),
  listEvents: vi.fn(), eventStats: vi.fn(), retryEvent: vi.fn(), purgeOldEvents: vi.fn(),
}));
vi.mock("../worker/signal.js", () => ({ wakeWorker: vi.fn(), onWake: vi.fn() }));

import { createApp } from "../app.js";
import * as sessions from "../auth/sessions.js";
import { emitChange } from "../events/bus.js";
import * as svc from "../events/service.js";
import { wakeWorker } from "../worker/signal.js";

const session = (id = 1, expiresInMs = 3_600_000) => ({
  sessionId: "s", csrfToken: "csrf", ghTokenEnc: null, expiresAt: new Date(Date.now() + expiresInMs),
  user: { id, login: "me", name: null, avatarUrl: null },
});

let server: Server;
let base: string;
beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sessions.findSession).mockResolvedValue(session());
  vi.mocked(svc.listEvents).mockResolvedValue({ events: [], nextCursor: null });
});

const call = (method: string, path: string, csrf: string | null = "csrf") =>
  fetch(`${base}/api/events${path}`, { method, headers: { cookie: "sid=v", ...(csrf ? { "x-csrf-token": csrf } : {}) } });

describe("GET /api/events", () => {
  it("requires login", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(null);
    expect((await call("GET", "")).status).toBe(401);
  });
  it("always queries as the logged-in user, with defaults", async () => {
    await call("GET", "");
    expect(svc.listEvents).toHaveBeenCalledWith(1, { limit: 30 });
  });
  it("passes validated filters through", async () => {
    await call("GET", "?repoId=5&status=dead&type=issues&cursor=99&limit=10");
    expect(svc.listEvents).toHaveBeenCalledWith(1, { repoId: 5, status: "dead", type: "issues", cursor: 99, limit: 10 });
  });
  it.each(["status=bogus", "type=release", "limit=0", "limit=1000", "repoId=abc", "cursor=-1", "repoId=1;DROP"])(
    "rejects bad query %s",
    async (q) => {
      expect((await call("GET", `?${q}`)).status).toBe(400);
      expect(svc.listEvents).not.toHaveBeenCalled();
    },
  );
  it("a different user gets their own scope, never someone else's", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(session(2));
    await call("GET", "?repoId=5");
    expect(svc.listEvents).toHaveBeenCalledWith(2, expect.objectContaining({ repoId: 5 }));
  });
});

describe("GET /api/events/stats", () => {
  it("returns scoped stats", async () => {
    vi.mocked(svc.eventStats).mockResolvedValue({ pending: 0, processing: 0, done: 3, failed: 1, dead: 0, total: 4 });
    expect(await (await call("GET", "/stats?repoId=7")).json()).toMatchObject({ total: 4 });
    expect(svc.eventStats).toHaveBeenCalledWith(1, 7);
  });
  it("rejects a bad repo id", async () => {
    expect((await call("GET", "/stats?repoId=x")).status).toBe(400);
  });
});

describe("POST /api/events/:id/retry", () => {
  it("needs CSRF", async () => {
    expect((await call("POST", "/5/retry", null)).status).toBe(403);
    expect(svc.retryEvent).not.toHaveBeenCalled();
  });
  it("queues a retry and wakes the worker", async () => {
    vi.mocked(svc.retryEvent).mockResolvedValue("queued");
    expect((await call("POST", "/5/retry")).status).toBe(200);
    expect(svc.retryEvent).toHaveBeenCalledWith(1, 5);
    expect(wakeWorker).toHaveBeenCalled();
  });
  it("404 for events that are not yours (indistinguishable from missing)", async () => {
    vi.mocked(svc.retryEvent).mockResolvedValue("not_found");
    expect((await call("POST", "/5/retry")).status).toBe(404);
    expect(wakeWorker).not.toHaveBeenCalled();
  });
  it("409 when the event is not failed/dead", async () => {
    vi.mocked(svc.retryEvent).mockResolvedValue("not_retryable");
    expect((await call("POST", "/5/retry")).status).toBe(409);
  });
  it("400 for a bad id", async () => {
    expect((await call("POST", "/abc/retry")).status).toBe(400);
  });
});

describe("GET /api/events/stream (SSE)", () => {
  async function open() {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events/stream`, { headers: { cookie: "sid=v" }, signal: ctrl.signal });
    return { res, ctrl };
  }
  // One outstanding read at a time: abandoning a pending read() would swallow the next chunk.
  const readUntil = async (res: Response, text: string, ms = 2000) => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    const deadline = Date.now() + ms;
    while (!buf.includes(text) && Date.now() < deadline) {
      pending ??= reader.read();
      const r = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 100))]);
      if (r === null) continue; // timed out: keep waiting on the SAME read
      pending = null;
      if (r.done) break;
      buf += dec.decode(r.value);
    }
    return buf;
  };

  it("requires login", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(null);
    expect((await fetch(`${base}/api/events/stream`)).status).toBe(401);
  });

  it("streams a data-free 'change' nudge when something changes", async () => {
    const { res, ctrl } = await open();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    setTimeout(emitChange, 50);
    const out = await readUntil(res, "event: change");
    expect(out).toContain("event: change");
    expect(out).toContain("data: {}"); // no payload: nothing can leak between users
    ctrl.abort();
  });

  it("coalesces a burst of changes into one nudge", async () => {
    const { res, ctrl } = await open();
    setTimeout(() => { emitChange(); emitChange(); emitChange(); }, 50);
    const out = await readUntil(res, "event: change");
    expect(out.match(/event: change/g)).toHaveLength(1);
    ctrl.abort();
  });

  it("ends the stream when the login session expires", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(session(9, 300));
    const { res, ctrl } = await open();
    const reader = res.body!.getReader();
    let ended = false;
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    const deadline = Date.now() + 3000;
    while (!ended && Date.now() < deadline) {
      pending ??= reader.read();
      const r = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 100))]);
      if (r === null) continue;
      pending = null;
      if (r.done) ended = true;
    }
    expect(ended).toBe(true);
    ctrl.abort();
  });

  it("limits concurrent streams per user", async () => {
    vi.mocked(sessions.findSession).mockResolvedValue(session(77));
    const open5 = await Promise.all(Array.from({ length: 5 }, open));
    expect(open5.every((o) => o.res.status === 200)).toBe(true);
    const sixth = await open();
    expect(sixth.res.status).toBe(429);
    [...open5, sixth].forEach((o) => o.ctrl.abort());
  });
});
