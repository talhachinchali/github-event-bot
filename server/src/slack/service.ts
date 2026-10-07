import { query } from "../db/index.js";
import { decrypt, encrypt } from "../auth/crypto.js";

/** Slack webhook URLs are secrets: stored AES-GCM encrypted, never returned to the browser. */
export async function saveWebhook(userId: number, url: string): Promise<void> {
  await query(
    `INSERT INTO slack_configs (user_id, webhook_url_enc) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET webhook_url_enc = $2, updated_at = now()`,
    [userId, encrypt(url)],
  );
}

export async function getWebhookForUser(userId: number): Promise<string | null> {
  const { rows } = await query<{ webhook_url_enc: string }>(
    "SELECT webhook_url_enc FROM slack_configs WHERE user_id = $1", [userId],
  );
  return rows[0] ? decrypt(rows[0].webhook_url_enc) : null;
}

/** The webhook belonging to whoever connected this repo. */
export async function getWebhookForRepo(repoId: number): Promise<string | null> {
  const { rows } = await query<{ webhook_url_enc: string }>(
    `SELECT s.webhook_url_enc FROM slack_configs s JOIN repos r ON r.owner_user_id = s.user_id WHERE r.id = $1`,
    [repoId],
  );
  return rows[0] ? decrypt(rows[0].webhook_url_enc) : null;
}

export async function deleteWebhook(userId: number): Promise<boolean> {
  const r = await query("DELETE FROM slack_configs WHERE user_id = $1", [userId]);
  return (r.rowCount ?? 0) > 0;
}

export async function isConfigured(userId: number): Promise<boolean> {
  const { rows } = await query("SELECT 1 FROM slack_configs WHERE user_id = $1", [userId]);
  return rows.length > 0;
}
