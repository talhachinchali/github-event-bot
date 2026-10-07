import { query } from "../db/index.js";
import type { EventType, Rule, RuleInput } from "./schema.js";

const MAX_RULES_PER_REPO = 50;
export class RuleLimitError extends Error {}

interface RuleRow {
  id: number; repo_id: number; name: string; enabled: boolean; event_type: EventType;
  conditions: Rule["conditions"]; actions: Rule["actions"]; use_ai: boolean; created_at: Date;
}
const COLS = "id, repo_id, name, enabled, event_type, conditions, actions, use_ai, created_at";
const toRule = (r: RuleRow): Rule => ({
  id: r.id, repoId: r.repo_id, name: r.name, enabled: r.enabled, eventType: r.event_type,
  conditions: r.conditions, actions: r.actions, useAi: r.use_ai, createdAt: r.created_at,
});

export async function listRules(repoId: number): Promise<Rule[]> {
  const { rows } = await query<RuleRow>(`SELECT ${COLS} FROM rules WHERE repo_id = $1 ORDER BY id`, [repoId]);
  return rows.map(toRule);
}

/** Enabled rules for an event type: what the worker evaluates. */
export async function listActiveRules(repoId: number, eventType: EventType): Promise<Rule[]> {
  const { rows } = await query<RuleRow>(
    `SELECT ${COLS} FROM rules WHERE repo_id = $1 AND event_type = $2 AND enabled ORDER BY id`,
    [repoId, eventType],
  );
  return rows.map(toRule);
}

export async function createRule(repoId: number, r: RuleInput): Promise<Rule> {
  const count = await query<{ n: number }>("SELECT count(*)::int AS n FROM rules WHERE repo_id = $1", [repoId]);
  if (count.rows[0]!.n >= MAX_RULES_PER_REPO) throw new RuleLimitError(`at most ${MAX_RULES_PER_REPO} rules per repo`);
  const { rows } = await query<RuleRow>(
    `INSERT INTO rules (repo_id, name, enabled, event_type, conditions, actions, use_ai)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
    [repoId, r.name, r.enabled, r.eventType, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.useAi],
  );
  return toRule(rows[0]!);
}

/** Scoped by repo_id so a rule id from another repo can never be modified through this one. */
export async function updateRule(repoId: number, ruleId: number, r: RuleInput): Promise<Rule | null> {
  const { rows } = await query<RuleRow>(
    `UPDATE rules SET name=$3, enabled=$4, event_type=$5, conditions=$6, actions=$7, use_ai=$8, updated_at=now()
      WHERE id = $2 AND repo_id = $1 RETURNING ${COLS}`,
    [repoId, ruleId, r.name, r.enabled, r.eventType, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.useAi],
  );
  return rows[0] ? toRule(rows[0]) : null;
}

export async function deleteRule(repoId: number, ruleId: number): Promise<boolean> {
  const r = await query("DELETE FROM rules WHERE id = $2 AND repo_id = $1", [repoId, ruleId]);
  return (r.rowCount ?? 0) > 0;
}
