import { Router } from "express";
import { config } from "../config.js";
import { requireAuth, requireCsrf } from "../auth/middleware.js";
import { reposRouter } from "./repos.js";

// Every /api route requires a session; every mutating one also requires the CSRF header.
export const apiRouter = Router();
apiRouter.use(requireAuth, requireCsrf);

apiRouter.get("/me", (req, res) => {
  const { user, csrfToken } = req.auth!;
  res.json({
    user,
    csrfToken,
    installUrl: `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
  });
});

apiRouter.use("/repos", reposRouter);
