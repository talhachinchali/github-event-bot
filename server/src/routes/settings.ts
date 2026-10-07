import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { logger } from "../logger.js";
import { escapeSlack, isValidSlackWebhookUrl, sendSlack } from "../slack/client.js";
import * as slack from "../slack/service.js";
import { ActionError } from "../worker/types.js";

// Mounted at /api/settings (login + CSRF applied by the parent).
export const settingsRouter = Router();

settingsRouter.get("/slack", async (req, res) => {
  // Only a boolean: the URL is a secret and is never sent back to the browser.
  res.json({ configured: await slack.isConfigured(req.auth!.user.id) });
});

settingsRouter.put("/slack", async (req, res) => {
  const body = z.object({ webhookUrl: z.string().trim().max(300) }).safeParse(req.body);
  if (!body.success || !isValidSlackWebhookUrl(body.data.webhookUrl)) {
    return void res.status(400).json({ error: "That does not look like a Slack incoming webhook URL (https://hooks.slack.com/services/...)" });
  }
  await slack.saveWebhook(req.auth!.user.id, body.data.webhookUrl);
  logger.info({ userId: req.auth!.user.id }, "slack webhook saved"); // never log the URL itself
  res.json({ configured: true });
});

settingsRouter.delete("/slack", async (req, res) => {
  await slack.deleteWebhook(req.auth!.user.id);
  res.json({ configured: false });
});

// Sends a real message so the user can verify the setup. Rate-limited: it triggers an outbound request.
settingsRouter.post(
  "/slack/test",
  rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false }),
  async (req, res) => {
    const url = await slack.getWebhookForUser(req.auth!.user.id);
    if (!url) return void res.status(400).json({ error: "Save a Slack webhook URL first" });
    try {
      await sendSlack(url, { text: `:white_check_mark: Repo Sentinel is connected, ${escapeSlack(req.auth!.user.login)}!` });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof ActionError ? err.message : "Slack request failed";
      res.status(502).json({ ok: false, error: message });
    }
  },
);
