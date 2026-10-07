import express, { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { normalize } from "../webhooks/normalize.js";
import * as svc from "../webhooks/service.js";
import { verifySignature } from "../webhooks/signature.js";

export const webhooksRouter = Router();

const DELIVERY_ID = /^[0-9a-f-]{36}$/i;
// Our own bot's events (e.g. its comments/labels) must never trigger rules: prevents feedback loops.
const BOT_LOGIN = `${config.GITHUB_APP_SLUG}[bot]`;

const installationPayload = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int(),
    account: z.object({ login: z.string(), type: z.string() }),
    repository_selection: z.string().optional(),
    suspended_at: z.string().nullish(),
  }),
});
const installationReposPayload = z.object({
  installation: z.object({ id: z.number().int() }),
  repositories_removed: z.array(z.object({ id: z.number().int() })).default([]),
});

// The raw parser is scoped to this route: signature verification needs the exact bytes GitHub sent.
webhooksRouter.post("/github", express.raw({ type: "application/json", limit: "5mb" }), async (req, res) => {
  const raw: unknown = req.body;
  if (!Buffer.isBuffer(raw)) return void res.status(415).json({ error: "expected application/json" });

  // 1. Authenticity. Nothing below runs for unsigned or forged requests.
  if (!verifySignature(raw, req.get("x-hub-signature-256"), config.GITHUB_WEBHOOK_SECRET)) {
    req.log.warn("webhook rejected: invalid signature");
    return void res.status(401).json({ error: "invalid signature" });
  }

  const eventName = req.get("x-github-event") ?? "";
  const deliveryId = req.get("x-github-delivery") ?? "";
  if (!eventName || !DELIVERY_ID.test(deliveryId)) return void res.status(400).json({ error: "missing github headers" });

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return void res.status(400).json({ error: "invalid json" });
  }

  const log = logger.child({ deliveryId, event: eventName });
  try {
    if (eventName === "ping") return void res.json({ status: "pong" });

    if (eventName === "installation") {
      const p = installationPayload.safeParse(payload);
      if (!p.success) return void res.status(400).json({ error: "malformed payload" });
      const { action, installation } = p.data;
      if (action === "deleted") await svc.deleteInstallation(installation.id);
      else if (action === "suspend") await svc.setSuspended(installation.id, true);
      else if (action === "unsuspend") await svc.setSuspended(installation.id, false);
      else if (action === "created") await svc.upsertInstallationFromEvent(installation);
      log.info({ action, installationId: installation.id }, "installation event handled");
      return void res.json({ status: "handled" });
    }

    if (eventName === "installation_repositories") {
      const p = installationReposPayload.safeParse(payload);
      if (!p.success) return void res.status(400).json({ error: "malformed payload" });
      await svc.removeRepos(p.data.installation.id, p.data.repositories_removed.map((r) => r.id));
      return void res.json({ status: "handled" });
    }

    const result = normalize(eventName, payload);
    if (!result.ok) {
      log.info({ reason: result.reason }, "webhook ignored");
      return void res.status(202).json({ status: "ignored", reason: result.reason });
    }
    const { event } = result;
    if (event.sender === BOT_LOGIN) {
      log.info("webhook ignored: sent by this bot");
      return void res.status(202).json({ status: "ignored", reason: "bot sender" });
    }
    if (!(await svc.findActiveRepo(event.repoId))) {
      log.info({ repo: event.repoFullName }, "webhook ignored: repo not connected");
      return void res.status(202).json({ status: "ignored", reason: "repo not connected" });
    }

    // 2. Durability + idempotency: persist BEFORE acknowledging. A duplicate delivery id is a no-op.
    const id = await svc.insertEvent(deliveryId, event);
    if (id === null) {
      log.info("duplicate delivery ignored");
      return void res.json({ status: "duplicate" });
    }
    log.info({ eventId: id, repo: event.repoFullName, action: event.action }, "event accepted");
    res.json({ status: "accepted", id });
  } catch (err) {
    // Non-2xx tells GitHub the delivery failed, so it stays visible and can be redelivered. Never swallow.
    log.error({ err: (err as Error).message }, "webhook processing failed");
    res.status(503).json({ error: "temporarily unavailable" });
  }
});
