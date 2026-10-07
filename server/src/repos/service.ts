import { query } from "../db/index.js";
import type { GhInstallation } from "../github/user-api.js";

export interface ConnectedRepo {
  id: number;
  installationId: number;
  fullName: string;
  enabled: boolean;
  createdAt: Date;
}

export class RepoConflictError extends Error {}

export async function upsertInstallation(i: GhInstallation): Promise<void> {
  await query(
    `INSERT INTO installations (id, account_login, account_type, repository_selection, suspended_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET account_login = $2, account_type = $3, repository_selection = $4, suspended_at = $5`,
    [i.id, i.account.login, i.account.type, i.repository_selection, i.suspended_at],
  );
}

export async function listConnected(userId: number): Promise<ConnectedRepo[]> {
  const { rows } = await query<{
    id: number; installation_id: number; full_name: string; enabled: boolean; created_at: Date;
  }>(
    `SELECT id, installation_id, full_name, enabled, created_at
       FROM repos WHERE owner_user_id = $1 ORDER BY full_name`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id, installationId: r.installation_id, fullName: r.full_name, enabled: r.enabled, createdAt: r.created_at,
  }));
}

/** Connects a repo. Connecting twice by the same user is a no-op; a repo owned by someone else is a conflict. */
export async function connectRepo(opts: {
  userId: number; installationId: number; repoId: number; fullName: string;
}): Promise<void> {
  const { rows } = await query<{ owner_user_id: number }>(
    `INSERT INTO repos (id, installation_id, owner_user_id, full_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, installation_id = EXCLUDED.installation_id
       WHERE repos.owner_user_id = EXCLUDED.owner_user_id
     RETURNING owner_user_id`,
    [opts.repoId, opts.installationId, opts.userId, opts.fullName],
  );
  // The WHERE on the conflict branch means no row comes back when someone else owns it.
  if (rows.length === 0) throw new RepoConflictError("repo is already connected by another user");
}

/** All three operations are scoped to the owner in SQL, so a user can never touch another user's repo. */
export async function setEnabled(userId: number, repoId: number, enabled: boolean): Promise<boolean> {
  const r = await query("UPDATE repos SET enabled = $3 WHERE id = $1 AND owner_user_id = $2", [repoId, userId, enabled]);
  return (r.rowCount ?? 0) > 0;
}

export async function disconnectRepo(userId: number, repoId: number): Promise<boolean> {
  const r = await query("DELETE FROM repos WHERE id = $1 AND owner_user_id = $2", [repoId, userId]);
  return (r.rowCount ?? 0) > 0;
}
