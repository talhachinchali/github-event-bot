import { logger } from "../logger.js";
import { addLabel, commentMarker, postCommentOnce } from "../github/app-api.js";
import { getRepoTarget } from "../repos/service.js";
import { sendSlack } from "../slack/client.js";
import { buildMessage } from "../slack/message.js";
import { getWebhookForRepo } from "../slack/service.js";
import { renderTemplate } from "./template.js";
import { ActionError, type ActionContext, type Executors } from "./types.js";

export interface ExecutorDeps {
  getRepoTarget: typeof getRepoTarget;
  getWebhookForRepo: typeof getWebhookForRepo;
  addLabel: typeof addLabel;
  postCommentOnce: typeof postCommentOnce;
  sendSlack: typeof sendSlack;
}

const realDeps: ExecutorDeps = { getRepoTarget, getWebhookForRepo, addLabel, postCommentOnce, sendSlack };

/** Issue/PR number: labels and comments only make sense on events that have one. */
function numberOf(ctx: ActionContext): number {
  const n = ctx.event.payload.number;
  if (ctx.event.eventType === "push" || typeof n !== "number") {
    throw new ActionError("this event has no issue/PR to act on", false);
  }
  return n;
}

async function targetOf(ctx: ActionContext, deps: ExecutorDeps) {
  const target = await deps.getRepoTarget(ctx.event.repoId);
  // Disconnected / uninstalled / suspended while the event was queued: nothing to do, don't retry.
  if (!target) throw new ActionError("repository is no longer connected", false);
  return target;
}

export function createExecutors(deps: ExecutorDeps = realDeps): Executors {
  return {
    async add_label(action, ctx) {
      if (action.type !== "add_label") throw new Error("executor mismatch");
      const target = await targetOf(ctx, deps);
      return { detail: await deps.addLabel(target.installationId, target.fullName, numberOf(ctx), action.label) };
    },

    async comment(action, ctx) {
      if (action.type !== "comment") throw new Error("executor mismatch");
      const target = await targetOf(ctx, deps);
      const body = renderTemplate(action.body, {
        title: ctx.event.title,
        author: ctx.event.author,
        number: numberOf(ctx),
        repo: target.fullName,
        url: ctx.event.url ?? "",
        ai_summary: ctx.ai?.summary,
        ai_priority: ctx.ai?.priority,
      }).slice(0, 5000);
      const marker = commentMarker(ctx.event.id, ctx.rule.id);
      return { detail: await deps.postCommentOnce(target.installationId, target.fullName, numberOf(ctx), body, marker) };
    },

    async add_ai_label(_action, ctx) {
      // The label is one of a fixed allow-list (validated in ai/triage.ts), so untrusted issue text cannot choose it.
      const label = ctx.ai?.label;
      if (!label) return { skipped: ctx.ai ? "AI suggested no label" : "AI triage unavailable" };
      const target = await targetOf(ctx, deps);
      return { detail: { ...(await deps.addLabel(target.installationId, target.fullName, numberOf(ctx), label)), source: "ai" } };
    },

    async slack(_action, ctx) {
      const url = await deps.getWebhookForRepo(ctx.event.repoId);
      if (!url) throw new ActionError("Slack is not configured: add a webhook URL in Settings", false);
      const target = await targetOf(ctx, deps);
      const p = ctx.event.payload;
      await deps.sendSlack(
        url,
        buildMessage({
          eventType: ctx.event.eventType,
          action: ctx.event.action,
          title: ctx.event.title,
          author: ctx.event.author,
          url: ctx.event.url,
          repo: target.fullName,
          number: typeof p.number === "number" ? p.number : undefined,
          branch: typeof p.branch === "string" ? p.branch : undefined,
          commitCount: typeof p.commitCount === "number" ? p.commitCount : undefined,
          aiSummary: ctx.ai?.summary,
          aiPriority: ctx.ai?.priority,
        }),
      );
      return { detail: { channel: "slack" } };
    },
  };
}

/** Logs what would happen and records 'skipped'. Used by tests and local experiments. */
const dryRun = (type: string) => async () => {
  logger.info({ type }, "dry-run action");
  return { skipped: "dry run" };
};
export const dryRunExecutors: Executors = {
  add_label: dryRun("add_label"),
  add_ai_label: dryRun("add_ai_label"),
  comment: dryRun("comment"),
  slack: dryRun("slack"),
};
