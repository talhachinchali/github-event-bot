import { ActionError } from "../worker/types.js";

const TIMEOUT_MS = 10_000;

/**
 * Only genuine Slack incoming-webhook URLs are accepted. Without this, the "webhook URL" setting would be an
 * SSRF primitive: users could make our server POST to internal addresses or arbitrary hosts.
 * Anchored, exact host, https, no credentials/port/query.
 */
const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

export function isValidSlackWebhookUrl(url: string): boolean {
  return SLACK_WEBHOOK.test(url);
}

/** Escapes the three characters Slack treats specially, so issue titles cannot inject <!channel>, links or mentions. */
export const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface SlackMessage {
  text: string; // plain fallback (notifications) and mrkdwn body
  blocks?: unknown[];
}

/** POSTs a message. Throws ActionError with retryable set from the HTTP status. */
export async function sendSlack(webhookUrl: string, message: SlackMessage): Promise<void> {
  if (!isValidSlackWebhookUrl(webhookUrl)) throw new ActionError("invalid Slack webhook URL", false);
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // never follow a redirect to somewhere else
    });
  } catch {
    // The error text is deliberately generic: fetch errors can embed the (secret) URL.
    throw new ActionError("Slack request failed: network error or timeout", true);
  }
  if (res.ok) return;
  // 429 / 5xx: transient. 400/403/404/410 (bad payload, revoked hook, archived channel): retrying cannot help.
  const retryable = res.status === 429 || res.status >= 500;
  throw new ActionError(`Slack responded HTTP ${res.status}`, retryable);
}
