import { Router } from "express";
import { z } from "zod";
import { onChange } from "../events/bus.js";
import * as events from "../events/service.js";
import { logger } from "../logger.js";
import { wakeWorker } from "../worker/signal.js";
import { emitChange } from "../events/bus.js";

// Mounted at /api/events (login + CSRF applied by the parent).
export const eventsRouter = Router();

const id = z.coerce.number().int().positive();
const listQuery = z.object({
  repoId: id.optional(),
  status: z.enum(events.STATUSES).optional(),
  type: z.enum(events.TYPES).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

eventsRouter.get("/", async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) return void res.status(400).json({ error: "invalid query" });
  res.json(await events.listEvents(req.auth!.user.id, q.data));
});

eventsRouter.get("/stats", async (req, res) => {
  const repoId = id.optional().safeParse(req.query.repoId);
  if (!repoId.success) return void res.status(400).json({ error: "invalid query" });
  res.json(await events.eventStats(req.auth!.user.id, repoId.data));
});

// --- live updates (Server-Sent Events) ---
const MAX_STREAMS_PER_USER = 5;
const HEARTBEAT_MS = 25_000;
const streams = new Map<number, number>();

eventsRouter.get("/stream", (req, res) => {
  const { user, expiresAt } = req.auth!;
  const open = streams.get(user.id) ?? 0;
  if (open >= MAX_STREAMS_PER_USER) return void res.status(429).json({ error: "too many open streams" });
  streams.set(user.id, open + 1);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // tell proxies not to buffer the stream
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n: connected\n\n");

  // Coalesce bursts (one event = several state changes) into a single "refetch" nudge.
  let pending: NodeJS.Timeout | null = null;
  const unsubscribe = onChange(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      res.write("event: change\ndata: {}\n\n");
    }, 250);
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  // Never outlive the login session: the client reconnects, gets 401 and returns to the sign-in page.
  const expiry = setTimeout(() => res.end(), Math.max(0, expiresAt.getTime() - Date.now()));

  req.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    if (pending) clearTimeout(pending);
    unsubscribe();
    const left = (streams.get(user.id) ?? 1) - 1;
    if (left <= 0) streams.delete(user.id);
    else streams.set(user.id, left);
  });
});

eventsRouter.post("/:id/retry", async (req, res) => {
  const eventId = id.safeParse(req.params.id);
  if (!eventId.success) return void res.status(400).json({ error: "invalid event id" });
  const result = await events.retryEvent(req.auth!.user.id, eventId.data);
  if (result === "not_found") return void res.status(404).json({ error: "event not found" });
  if (result === "not_retryable") return void res.status(409).json({ error: "only failed or dead events can be retried" });
  logger.info({ userId: req.auth!.user.id, eventId: eventId.data }, "event manually retried");
  emitChange();
  wakeWorker();
  res.json({ ok: true });
});
