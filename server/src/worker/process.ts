import { ruleMatches, viewOf } from "../rules/engine.js";
import type { EventType, Rule, RuleAction } from "../rules/schema.js";
import { MAX_ATTEMPTS } from "./backoff.js";
import { ActionError, type EventRow, type Executors, type Outcome } from "./types.js";

export interface ProcessDeps {
  loadRules(repoId: number, eventType: EventType): Promise<Rule[]>;
  executors: Executors;
  hasSucceeded(eventId: number, actionKey: string): Promise<boolean>;
  recordAction(a: {
    eventId: number; ruleId: number; actionKey: string; type: string;
    status: "success" | "failed" | "skipped"; attempt: number; error?: string; detail?: Record<string, unknown>;
  }): Promise<void>;
}

/** Stable identity of one action of one rule: the idempotency key (unique per event). */
export function actionKey(rule: Pick<Rule, "id">, action: RuleAction): string {
  switch (action.type) {
    case "add_label": return `rule:${rule.id}:add_label:${action.label.toLowerCase()}`;
    case "comment": return `rule:${rule.id}:comment`;
    case "slack": return `rule:${rule.id}:slack`;
  }
}

/**
 * Runs every action of every matching rule. Safe to call again for the same event: actions that
 * already succeeded are skipped, so a retry only redoes what failed.
 */
export async function processEvent(ev: EventRow, deps: ProcessDeps): Promise<Outcome> {
  const view = viewOf(ev);
  const matched = (await deps.loadRules(ev.repoId, ev.eventType)).filter((r) => ruleMatches(r, view));

  const errors: string[] = [];
  let anyRetryable = false;

  for (const rule of matched) {
    for (const action of rule.actions) {
      const key = actionKey(rule, action);
      if (await deps.hasSucceeded(ev.id, key)) continue;

      try {
        const result = await deps.executors[action.type](action, { event: ev, rule });
        await deps.recordAction({
          eventId: ev.id, ruleId: rule.id, actionKey: key, type: action.type, attempt: ev.attempts,
          status: result?.skipped ? "skipped" : "success",
          detail: result?.skipped ? { reason: result.skipped } : result?.detail,
        });
      } catch (err) {
        const retryable = err instanceof ActionError ? err.retryable : true; // unknown errors: assume transient
        const message = (err as Error).message ?? "unknown error";
        anyRetryable ||= retryable;
        errors.push(`${action.type}: ${message}`);
        await deps.recordAction({
          eventId: ev.id, ruleId: rule.id, actionKey: key, type: action.type, attempt: ev.attempts,
          status: "failed", error: message, detail: { retryable },
        });
        // Keep going: one failing action must not block the others.
      }
    }
  }

  if (errors.length === 0) return { status: "done" };
  const error = errors.join("; ");
  return anyRetryable && ev.attempts < MAX_ATTEMPTS ? { status: "retry", error } : { status: "dead", error };
}
