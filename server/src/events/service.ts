import { query } from "../db/index.js";

export const STATUSES = ["pending", "processing", "done", "failed", "dead"] as const;
export const TYPES = ["issues", "pull_request", "push"] as const;
export type EventStatus = (typeof STATUSES)[number];

export interface EventFilters {
  repoId?: number;
  status?: EventStatus;
  type?: (typeof TYPES)[number];
  cursor?: number;
  limit: number;
}

export interface ActionView {
  id: number; type: string; status: string; attempt: number; error: string | null;
  detail: Record<string, unknown> | null; ruleName: string | null; createdAt: string;
}

export interface EventView {
  id: number; repoId: number; repo: string; eventType: string; action: string | null; title: string;
  author: string; url: string | null; status: EventStatus; attempts: number; lastError: string | null;
  receivedAt: Date; processedAt: Date | null; nextAttemptAt: Date;
  ai: { summary: string; priority: string; label: string | null } | null;
  actions: ActionView[];
}

interface Row {
  id: number; repo_id: number; full_name: string; event_type: string; action: string | null; title: string;
  author: string; url: string | null; status: EventStatus; attempts: number; last_error: string | null;
  received_at: Date; processed_at: Date | null; next_attempt_at: Date; ai: EventView["ai"];
  actions: { id: number; type: string; status: string; attempt: number; error: string | null; detail: Record<string, unknown> | null; rule_name: string | null; created_at: string }[];
}

/**
 * Newest first, keyset-paginated, ALWAYS scoped to repos owned by `userId` (the join is the access control).
 * Actions are aggregated in the same query to avoid an N+1 from the dashboard.
 */
export async function listEvents(userId: number, f: EventFilters): Promise<{ events: EventView[]; nextCursor: number | null }> {
  const { rows } = await query<Row>(
    `SELECT e.id, e.repo_id, r.full_name, e.event_type, e.action, e.title, e.author, e.url, e.status, e.attempts,
            e.last_error, e.received_at, e.processed_at, e.next_attempt_at, e.ai,
            (SELECT COALESCE(json_agg(json_build_object(
                      'id', a.id, 'type', a.type, 'status', a.status, 'attempt', a.attempt, 'error', a.error,
                      'detail', a.detail, 'rule_name', ru.name, 'created_at', a.created_at) ORDER BY a.id), '[]'::json)
               FROM actions a LEFT JOIN rules ru ON ru.id = a.rule_id WHERE a.event_id = e.id) AS actions
       FROM events e JOIN repos r ON r.id = e.repo_id
      WHERE r.owner_user_id = $1
        AND ($2::bigint IS NULL OR e.repo_id = $2)
        AND ($3::text IS NULL OR e.status = $3)
        AND ($4::text IS NULL OR e.event_type = $4)
        AND ($5::bigint IS NULL OR e.id < $5)
      ORDER BY e.id DESC
      LIMIT $6`,
    [userId, f.repoId ?? null, f.status ?? null, f.type ?? null, f.cursor ?? null, f.limit + 1],
  );
  const page = rows.slice(0, f.limit);
  return {
    events: page.map((r) => ({
      id: r.id, repoId: r.repo_id, repo: r.full_name, eventType: r.event_type, action: r.action, title: r.title,
      author: r.author, url: r.url, status: r.status, attempts: r.attempts, lastError: r.last_error,
      receivedAt: r.received_at, processedAt: r.processed_at, nextAttemptAt: r.next_attempt_at, ai: r.ai,
      actions: r.actions.map((a) => ({
        id: a.id, type: a.type, status: a.status, attempt: a.attempt, error: a.error, detail: a.detail,
        ruleName: a.rule_name, createdAt: a.created_at,
      })),
    })),
    nextCursor: rows.length > f.limit ? page[page.length - 1]!.id : null,
  };
}

export async function eventStats(userId: number, repoId?: number): Promise<Record<EventStatus | "total", number>> {
  const { rows } = await query<{ status: EventStatus; n: number }>(
    `SELECT e.status, count(*)::int AS n FROM events e JOIN repos r ON r.id = e.repo_id
      WHERE r.owner_user_id = $1 AND ($2::bigint IS NULL OR e.repo_id = $2) GROUP BY e.status`,
    [userId, repoId ?? null],
  );
  const stats = { pending: 0, processing: 0, done: 0, failed: 0, dead: 0, total: 0 };
  for (const r of rows) {
    stats[r.status] = r.n;
    stats.total += r.n;
  }
  return stats;
}

export type RetryResult = "queued" | "not_found" | "not_retryable";

/**
 * Manual retry for a failed/dead event. Attempts are reset so it gets a fresh budget. This is safe because
 * actions that already succeeded are skipped by their idempotency key, so only the failed work is redone.
 */
export async function retryEvent(userId: number, eventId: number): Promise<RetryResult> {
  const upd = await query(
    `UPDATE events e SET status = 'pending', attempts = 0, next_attempt_at = now(), locked_at = NULL
       FROM repos r
      WHERE e.id = $1 AND r.id = e.repo_id AND r.owner_user_id = $2 AND e.status IN ('failed', 'dead')`,
    [eventId, userId],
  );
  if ((upd.rowCount ?? 0) > 0) return "queued";
  const { rows } = await query(
    "SELECT 1 FROM events e JOIN repos r ON r.id = e.repo_id WHERE e.id = $1 AND r.owner_user_id = $2",
    [eventId, userId],
  );
  return rows.length > 0 ? "not_retryable" : "not_found";
}

/** Retention: keeps the free-tier database small. Cascades to the actions of the deleted events. */
export async function purgeOldEvents(days: number): Promise<number> {
  const r = await query(
    "DELETE FROM events WHERE received_at < now() - make_interval(days => $1) AND status IN ('done', 'dead')",
    [days],
  );
  return r.rowCount ?? 0;
}
