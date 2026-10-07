import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { decrypt } from "../auth/crypto.js";
import { logger } from "../logger.js";
import { GitHubApiError, listInstallationRepos, listUserInstallations } from "../github/user-api.js";
import * as repos from "../repos/service.js";
import { rulesRouter } from "./rules.js";

export const reposRouter = Router();

const idParam = z.coerce.number().int().positive();

/** The user's GitHub token lives encrypted in the session; it expires with the session. */
function userToken(req: Request): string {
  const enc = req.auth?.ghTokenEnc;
  if (!enc) throw new GitHubApiError(401, "no github token in session");
  return decrypt(enc);
}

// GitHub rejected our user token (expired/revoked): tell the UI to sign in again.
function handleGitHubErrors(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof GitHubApiError) {
    if (err.status === 401) return void res.status(401).json({ error: "github_token_expired" });
    logger.warn({ status: err.status, err: err.message }, "github api error");
    return void res.status(502).json({ error: "github_unavailable" });
  }
  next(err);
}

// Connected repos only: database-only and fast (the dashboard uses this for filters and pickers).
reposRouter.get("/connected", async (req, res) => {
  res.json({ connected: await repos.listConnected(req.auth!.user.id) });
});

// Connected repos + repos that could still be connected (live from GitHub).
reposRouter.get("/", async (req, res) => {
  const token = userToken(req);
  const installations = (await listUserInstallations(token)).filter((i) => !i.suspended_at);
  await Promise.all(installations.map(repos.upsertInstallation));

  const perInstall = await Promise.all(
    installations.map(async (i) => ({
      installationId: i.id,
      account: i.account.login,
      repos: await listInstallationRepos(token, i.id),
    })),
  );
  const connected = await repos.listConnected(req.auth!.user.id);
  const connectedIds = new Set(connected.map((r) => r.id));

  const available = perInstall.flatMap((i) =>
    i.repos
      .filter((r) => !connectedIds.has(r.id))
      .map((r) => ({
        id: r.id,
        fullName: r.full_name,
        private: r.private,
        installationId: i.installationId,
        canConnect: r.permissions?.admin === true,
      })),
  );
  res.json({
    connected,
    available,
    installations: installations.map((i) => ({ id: i.id, account: i.account.login })),
  });
});

const connectBody = z.object({ installationId: z.number().int().positive(), repoId: z.number().int().positive() });

reposRouter.post("/", async (req, res) => {
  const body = connectBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "invalid body" });
  const { installationId, repoId } = body.data;
  const token = userToken(req);

  // Never trust ids from the browser: GitHub must confirm the user can access the repo through this installation...
  const installations = await listUserInstallations(token);
  const installation = installations.find((i) => i.id === installationId && !i.suspended_at);
  if (!installation) return void res.status(404).json({ error: "installation not found" });
  const repo = (await listInstallationRepos(token, installationId)).find((r) => r.id === repoId);
  if (!repo) return void res.status(404).json({ error: "repo not found" });
  // ...and the user must be an admin/owner of it.
  if (repo.permissions?.admin !== true) {
    return void res.status(403).json({ error: "you need admin access to connect this repo" });
  }

  await repos.upsertInstallation(installation);
  try {
    await repos.connectRepo({ userId: req.auth!.user.id, installationId, repoId, fullName: repo.full_name });
  } catch (err) {
    if (err instanceof repos.RepoConflictError) return void res.status(409).json({ error: err.message });
    throw err;
  }
  logger.info({ userId: req.auth!.user.id, repoId, repo: repo.full_name }, "repo connected");
  res.status(201).json({ ok: true });
});

reposRouter.patch("/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!id.success || !body.success) return void res.status(400).json({ error: "invalid request" });
  const ok = await repos.setEnabled(req.auth!.user.id, id.data, body.data.enabled);
  res.status(ok ? 200 : 404).json({ ok });
});

reposRouter.delete("/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "invalid request" });
  const ok = await repos.disconnectRepo(req.auth!.user.id, id.data);
  res.status(ok ? 200 : 404).json({ ok });
});

reposRouter.use("/:repoId/rules", rulesRouter);

reposRouter.use(handleGitHubErrors);
