import type { EventType, Rule, RuleAction } from "../rules/schema.js";

/** An event as claimed from the queue. `attempts` already includes the current attempt. */
export interface EventRow {
  id: number;
  repoId: number;
  eventType: EventType;
  action: string | null;
  title: string;
  author: string;
  url: string | null;
  payload: Record<string, unknown>;
  /** Cached AI triage (so retries never call the model again), or null. */
  ai: AiTriage | null;
  attempts: number;
}

/** Result of the optional AI triage step (step 8). */
export interface AiTriage {
  summary: string;
  priority: "low" | "medium" | "high" | "critical";
  label: string | null;
}

export interface ActionContext {
  event: EventRow;
  rule: Rule;
  /** Present only when the rule has AI enabled and the model answered. */
  ai?: AiTriage;
}

/** Thrown by executors. `retryable: false` = retrying cannot help (e.g. 404/403/422 from GitHub). */
export class ActionError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface ActionResult {
  /** Set when nothing was actually done (e.g. dry run). Recorded as 'skipped'. */
  skipped?: string;
  detail?: Record<string, unknown>;
}

export type Executor = (action: RuleAction, ctx: ActionContext) => Promise<ActionResult | void>;
export type Executors = { [K in RuleAction["type"]]: Executor };

export type Outcome =
  | { status: "done" }
  | { status: "retry"; error: string }
  | { status: "dead"; error: string };
