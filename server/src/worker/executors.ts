import { logger } from "../logger.js";
import type { Executors } from "./types.js";

/**
 * Placeholder executors: log what *would* happen and record the action as 'skipped'.
 * Replaced by the real GitHub / Slack executors in step 7.
 */
const dryRun = (type: string) => async () => {
  logger.info({ type }, "dry-run action (no executor wired yet)");
  return { skipped: "dry run: executor not implemented yet" };
};

export const dryRunExecutors: Executors = {
  add_label: dryRun("add_label"),
  comment: dryRun("comment"),
  slack: dryRun("slack"),
};
