import { query } from "../db/index.js";
import type { NormalizedEvent } from "./normalize.js";

/** A repo the bot should react to: connected, not paused, and its installation not suspended. */
export async function findActiveRepo(repoId: number): Promise<{ id: number } | null> {
  const { rows } = await query<{ id: number }>(
    `SELECT r.id FROM repos r JOIN installations i ON i.id = r.installation_id
      WHERE r.id = $1 AND r.enabled AND i.suspended_at IS NULL`,
    [repoId],
  );
  return rows[0] ?? null;
}

/**
 * Persists the event as 'pending' (the work queue). Returns the new id, or null if this delivery
 * was already stored (GitHub redelivery / replayed request): the UNIQUE(delivery_id) makes it a no-op.
 */
export async function insertEvent(deliveryId: string, e: NormalizedEvent): Promise<number | null> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO events (delivery_id, repo_id, event_type, action, title, author, url, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (delivery_id) DO NOTHING
     RETURNING id`,
    [
      deliveryId, e.repoId, e.eventType, e.action, e.title, e.author, e.url,
      JSON.stringify({ ...e.payload, installationId: e.installationId, repo: e.repoFullName }),
    ],
  );
  return rows[0]?.id ?? null;
}

// --- Installation lifecycle: keep our tables in sync when users change the app on GitHub ---

export async function upsertInstallationFromEvent(i: {
  id: number; account: { login: string; type: string }; repository_selection?: string; suspended_at?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO installations (id, account_login, account_type, repository_selection, suspended_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET account_login = $2, account_type = $3, repository_selection = $4, suspended_at = $5`,
    [i.id, i.account.login, i.account.type, i.repository_selection ?? "selected", i.suspended_at ?? null],
  );
}

/** Uninstall: removes the installation and, by cascade, its connected repos, rules and history. */
export async function deleteInstallation(id: number): Promise<void> {
  await query("DELETE FROM installations WHERE id = $1", [id]);
}

export async function setSuspended(id: number, suspended: boolean): Promise<void> {
  await query("UPDATE installations SET suspended_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1", [id, suspended]);
}

/** Repos removed from an installation can no longer be acted on: disconnect them. */
export async function removeRepos(installationId: number, repoIds: number[]): Promise<void> {
  if (repoIds.length === 0) return;
  await query("DELETE FROM repos WHERE installation_id = $1 AND id = ANY($2::bigint[])", [installationId, repoIds]);
}
