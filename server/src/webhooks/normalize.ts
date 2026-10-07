import { z } from "zod";

// Only these actions are acted on. Deliberately excludes "labeled"/"edited"/etc: the bot's own label
// changes would otherwise come back as webhooks and could trigger rules again (feedback loop).
const ACTIONS: Record<string, readonly string[]> = {
  issues: ["opened", "reopened"],
  pull_request: ["opened", "reopened", "ready_for_review"],
};

export type EventType = "issues" | "pull_request" | "push";

export interface NormalizedEvent {
  repoId: number;
  repoFullName: string;
  installationId: number | null;
  eventType: EventType;
  action: string | null;
  title: string;
  author: string;
  url: string | null;
  sender: string;
  /** Trimmed subset of the webhook payload: all the rules engine / worker need. */
  payload: Record<string, unknown>;
}

export type NormalizeResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; reason: string };

const clip = (s: string | null | undefined, n: number) => (s ?? "").slice(0, n);

const repo = z.object({ id: z.number().int(), full_name: z.string() });
const user = z.object({ login: z.string() });
const base = {
  repository: repo,
  sender: user,
  installation: z.object({ id: z.number().int() }).optional(),
};
const labels = z.array(z.object({ name: z.string() })).default([]);

const issuesSchema = z.object({
  ...base,
  action: z.string(),
  issue: z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullish(),
    html_url: z.string(),
    user: user,
    labels,
  }),
});

const prSchema = z.object({
  ...base,
  action: z.string(),
  pull_request: z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullish(),
    html_url: z.string(),
    draft: z.boolean().optional(),
    user: user,
    labels,
    base: z.object({ ref: z.string() }),
    head: z.object({ ref: z.string() }),
  }),
});

const commit = z.object({ id: z.string(), message: z.string(), author: z.object({ name: z.string().optional() }).optional() });
const pushSchema = z.object({
  ...base,
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  deleted: z.boolean().default(false),
  forced: z.boolean().default(false),
  compare: z.string().optional(),
  commits: z.array(commit).default([]),
  head_commit: commit.nullish(),
});

/** Turns a raw (already signature-verified) webhook payload into our internal event, or says why it is ignored. */
export function normalize(eventName: string, payload: unknown): NormalizeResult {
  if (eventName !== "issues" && eventName !== "pull_request" && eventName !== "push") {
    return { ok: false, reason: `unsupported event: ${eventName}` };
  }
  const parsed = (schema: z.ZodType) => schema.safeParse(payload);

  if (eventName === "issues") {
    const r = parsed(issuesSchema);
    if (!r.success) return { ok: false, reason: "malformed issues payload" };
    const p = r.data as z.infer<typeof issuesSchema>;
    if (!ACTIONS.issues!.includes(p.action)) return { ok: false, reason: `ignored action: issues.${p.action}` };
    return {
      ok: true,
      event: {
        repoId: p.repository.id, repoFullName: p.repository.full_name, installationId: p.installation?.id ?? null,
        eventType: "issues", action: p.action, title: clip(p.issue.title, 300), author: p.issue.user.login,
        url: p.issue.html_url, sender: p.sender.login,
        payload: {
          number: p.issue.number, title: clip(p.issue.title, 300), body: clip(p.issue.body, 4000),
          author: p.issue.user.login, labels: p.issue.labels.map((l) => l.name),
        },
      },
    };
  }

  if (eventName === "pull_request") {
    const r = parsed(prSchema);
    if (!r.success) return { ok: false, reason: "malformed pull_request payload" };
    const p = r.data as z.infer<typeof prSchema>;
    if (!ACTIONS.pull_request!.includes(p.action)) return { ok: false, reason: `ignored action: pull_request.${p.action}` };
    const pr = p.pull_request;
    return {
      ok: true,
      event: {
        repoId: p.repository.id, repoFullName: p.repository.full_name, installationId: p.installation?.id ?? null,
        eventType: "pull_request", action: p.action, title: clip(pr.title, 300), author: pr.user.login,
        url: pr.html_url, sender: p.sender.login,
        payload: {
          number: pr.number, title: clip(pr.title, 300), body: clip(pr.body, 4000), author: pr.user.login,
          labels: pr.labels.map((l) => l.name), base: pr.base.ref, head: pr.head.ref, draft: pr.draft ?? false,
        },
      },
    };
  }

  const r = parsed(pushSchema);
  if (!r.success) return { ok: false, reason: "malformed push payload" };
  const p = r.data as z.infer<typeof pushSchema>;
  if (p.deleted) return { ok: false, reason: "ignored: branch/tag deletion" };
  const branch = p.ref.replace(/^refs\/(heads|tags)\//, "");
  const headMessage = (p.head_commit?.message ?? "").split("\n")[0] ?? "";
  return {
    ok: true,
    event: {
      repoId: p.repository.id, repoFullName: p.repository.full_name, installationId: p.installation?.id ?? null,
      eventType: "push", action: null, title: clip(headMessage || `Push to ${branch}`, 300), author: p.sender.login,
      url: p.compare ?? null, sender: p.sender.login,
      payload: {
        ref: p.ref, branch, before: p.before, after: p.after, forced: p.forced, commitCount: p.commits.length,
        // GitHub caps this list at 20 commits; keep it small and clipped.
        commits: p.commits.slice(0, 20).map((c) => ({ id: c.id.slice(0, 40), message: clip(c.message, 300), author: c.author?.name ?? "" })),
      },
    },
  };
}
