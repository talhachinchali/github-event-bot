import { Router } from "express";
import { z } from "zod";
import { logger } from "../logger.js";
import { isRepoOwner } from "../repos/service.js";
import { ruleInputSchema } from "../rules/schema.js";
import * as rules from "../rules/service.js";

// Mounted at /api/repos/:repoId/rules (auth + CSRF are applied by the parent routers).
export const rulesRouter = Router({ mergeParams: true });

const id = z.coerce.number().int().positive();

// Every handler first proves the logged-in user owns the repo in the URL.
rulesRouter.use(async (req, res, next) => {
  const repoId = id.safeParse(req.params.repoId);
  if (!repoId.success) return void res.status(400).json({ error: "invalid repo id" });
  if (!(await isRepoOwner(req.auth!.user.id, repoId.data))) return void res.status(404).json({ error: "repo not found" });
  res.locals.repoId = repoId.data;
  next();
});

rulesRouter.get("/", async (_req, res) => {
  res.json({ rules: await rules.listRules(res.locals.repoId) });
});

rulesRouter.post("/", async (req, res) => {
  const body = ruleInputSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "invalid rule", issues: body.error.issues.map((i) => ({ path: i.path, message: i.message })) });
  try {
    const rule = await rules.createRule(res.locals.repoId, body.data);
    logger.info({ userId: req.auth!.user.id, repoId: res.locals.repoId, ruleId: rule.id }, "rule created");
    res.status(201).json({ rule });
  } catch (err) {
    if (err instanceof rules.RuleLimitError) return void res.status(409).json({ error: err.message });
    throw err;
  }
});

rulesRouter.put("/:ruleId", async (req, res) => {
  const ruleId = id.safeParse(req.params.ruleId);
  const body = ruleInputSchema.safeParse(req.body);
  if (!ruleId.success) return void res.status(400).json({ error: "invalid rule id" });
  if (!body.success) return void res.status(400).json({ error: "invalid rule", issues: body.error.issues.map((i) => ({ path: i.path, message: i.message })) });
  const rule = await rules.updateRule(res.locals.repoId, ruleId.data, body.data);
  if (!rule) return void res.status(404).json({ error: "rule not found" });
  res.json({ rule });
});

rulesRouter.delete("/:ruleId", async (req, res) => {
  const ruleId = id.safeParse(req.params.ruleId);
  if (!ruleId.success) return void res.status(400).json({ error: "invalid rule id" });
  const ok = await rules.deleteRule(res.locals.repoId, ruleId.data);
  res.status(ok ? 200 : 404).json({ ok });
});
