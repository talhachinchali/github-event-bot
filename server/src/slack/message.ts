import { escapeSlack, type SlackMessage } from "./client.js";

export interface NotifyEvent {
  eventType: "issues" | "pull_request" | "push";
  action: string | null;
  title: string;
  author: string;
  url: string | null;
  repo: string;
  number?: number;
  branch?: string;
  commitCount?: number;
  /** Filled by the AI step (step 8). */
  aiSummary?: string;
  aiPriority?: string;
}

const LABEL: Record<NotifyEvent["eventType"], string> = {
  issues: "Issue",
  pull_request: "Pull request",
  push: "Push",
};

/** Builds the Slack message for an event. Every piece of user-controlled text is escaped. */
export function buildMessage(e: NotifyEvent): SlackMessage {
  const title = escapeSlack(e.title.slice(0, 200));
  const repo = escapeSlack(e.repo);
  const author = escapeSlack(e.author);
  // Only https GitHub links are turned into Slack links; anything else is shown as plain text.
  const safeUrl = e.url && /^https:\/\/github\.com\/[^\s<>|]+$/.test(e.url) ? e.url : null;
  const link = (text: string) => (safeUrl ? `<${safeUrl}|${text}>` : text);

  let headline: string;
  if (e.eventType === "push") {
    const n = e.commitCount ?? 1;
    headline = `*${repo}*: ${n} commit${n === 1 ? "" : "s"} pushed to \`${escapeSlack(e.branch ?? "?")}\` by ${author}\n${link(title)}`;
  } else {
    const ref = e.number ? `#${e.number} ` : "";
    headline = `*${repo}*: ${LABEL[e.eventType]} ${e.action ?? ""} by ${author}\n${link(`${ref}${title}`)}`;
  }

  const extras: string[] = [];
  if (e.aiPriority) extras.push(`*Priority:* ${escapeSlack(e.aiPriority)}`);
  if (e.aiSummary) extras.push(`*AI summary:* ${escapeSlack(e.aiSummary.slice(0, 500))}`);
  const text = [headline, ...extras].join("\n");

  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}
