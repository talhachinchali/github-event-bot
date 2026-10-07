import { query } from "../db/index.js";
import type { AiTriage, EventRow } from "./types.js";
import type { EventType } from "../rules/schema.js";

/** A 'processing' event whose worker vanished (crash, deploy) is reclaimed after this long. */
export const STALE_LOCK_SECONDS = 300;

interface Row {
  id: number; repo_id: number; event_type: EventType; action: string | null; title: string;
  author: string; url: string | null; payload: Record<string, unknown>; ai: AiTriage | null; attempts: number;
}

/**
 * Atomically claims the next due event. FOR UPDATE SKIP LOCKED means concurrent workers
 * (e.g. two instances during a deploy) never take the same row. Also reclaims stale 'processing' rows.
 */
export async function claimNext(): Promise<EventRow | null> {
  const { rows } = await query<Row>(
    `UPDATE events SET status = 'processing', locked_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM events
         WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
            OR (status = 'processing' AND locked_at < now() - make_interval(secs => $1))
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, repo_id, event_type, action, title, author, url, payload, ai, attempts`,
    [STALE_LOCK_SECONDS],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, repoId: r.repo_id, eventType: r.event_type, action: r.action, title: r.title,
    author: r.author, url: r.url, payload: r.payload, ai: r.ai, attempts: r.attempts,
  };
}

const clip = (s: string) => s.slice(0, 500);

export async function markDone(id: number): Promise<void> {
  await query(
    "UPDATE events SET status = 'done', processed_at = now(), locked_at = NULL, last_error = NULL WHERE id = $1",
    [id],
  );
}

export async function markRetry(id: number, error: string, delaySeconds: number): Promise<void> {
  await query(
    `UPDATE events SET status = 'failed', locked_at = NULL, last_error = $2,
            next_attempt_at = now() + make_interval(secs => $3)
      WHERE id = $1`,
    [id, clip(error), delaySeconds],
  );
}

/** Terminal: will not be retried automatically. Stays visible on the dashboard. */
export async function markDead(id: number, error: string): Promise<void> {
  await query(
    "UPDATE events SET status = 'dead', processed_at = now(), locked_at = NULL, last_error = $2 WHERE id = $1",
    [id, clip(error)],
  );
}

/** When the worker should next wake up on its own (earliest retry or stale-lock expiry), or null if idle. */
export async function nextWakeTime(): Promise<Date | null> {
  const { rows } = await query<{ t: Date | null }>(
    `SELECT min(CASE status WHEN 'processing' THEN locked_at + make_interval(secs => $1)
                            ELSE next_attempt_at END) AS t
       FROM events WHERE status IN ('pending', 'failed', 'processing')`,
    [STALE_LOCK_SECONDS],
  );
  return rows[0]?.t ?? null;
}

// --- action log ---

export async function hasSucceeded(eventId: number, actionKey: string): Promise<boolean> {
  const { rows } = await query(
    "SELECT 1 FROM actions WHERE event_id = $1 AND action_key = $2 AND status = 'success'",
    [eventId, actionKey],
  );
  return rows.length > 0;
}

export async function recordAction(a: {
  eventId: number; ruleId: number | null; actionKey: string; type: string;
  status: "success" | "failed" | "skipped"; attempt: number; error?: string; detail?: Record<string, unknown>;
}): Promise<void> {
  // ON CONFLICT: the partial unique index makes a second success for the same action a no-op, even under a race.
  await query(
    `INSERT INTO actions (event_id, rule_id, action_key, type, status, attempt, error, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [a.eventId, a.ruleId, a.actionKey, a.type, a.status, a.attempt, a.error ? clip(a.error) : null, a.detail ? JSON.stringify(a.detail) : null],
  );
}

/** Caches the AI result on the event so a retry reuses it instead of calling the model again. */
export async function saveAi(eventId: number, ai: AiTriage): Promise<void> {
  await query("UPDATE events SET ai = $2 WHERE id = $1", [eventId, JSON.stringify(ai)]);
}
