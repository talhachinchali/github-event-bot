import type { Condition, EventType, Rule } from "./schema.js";

/** The facts a rule can look at, extracted from a stored event. */
export interface EventView {
  eventType: EventType;
  action: string | null;
  title: string;
  author: string;
  body: string;
  labels: string[];
  /** push: branch pushed to. pull_request: target branch. issues: null. */
  branch: string | null;
}

export function viewOf(ev: {
  eventType: EventType; action: string | null; title: string; author: string; payload: Record<string, unknown>;
}): EventView {
  const p = ev.payload as { body?: unknown; labels?: unknown; branch?: unknown; base?: unknown };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    eventType: ev.eventType,
    action: ev.action,
    title: ev.title,
    author: ev.author,
    body: str(p.body) ?? "",
    labels: Array.isArray(p.labels) ? p.labels.filter((l): l is string => typeof l === "string") : [],
    branch: ev.eventType === "push" ? str(p.branch) : ev.eventType === "pull_request" ? str(p.base) : null,
  };
}

const norm = (s: string) => s.toLowerCase();

function compare(op: Condition["op"], actual: string, expected: string): boolean {
  const a = norm(actual);
  const e = norm(expected);
  switch (op) {
    case "contains": return a.includes(e);
    case "not_contains": return !a.includes(e);
    case "equals": return a === e;
    case "starts_with": return a.startsWith(e);
  }
}

/** Case-insensitive, plain-text matching (no user regex: avoids ReDoS). */
export function conditionMatches(c: Condition, ev: EventView): boolean {
  if (c.field === "label") {
    // Negative operators must hold for *every* label ("no label contains x"); positive ones for *any*.
    return c.op === "not_contains"
      ? ev.labels.every((l) => compare(c.op, l, c.value))
      : ev.labels.some((l) => compare(c.op, l, c.value));
  }
  if (c.field === "branch") return ev.branch !== null && compare(c.op, ev.branch, c.value);
  return compare(c.op, ev[c.field], c.value);
}

/** A rule matches when it is enabled, targets this event type, and ALL its conditions hold (none = always). */
export function ruleMatches(rule: Pick<Rule, "enabled" | "eventType" | "conditions">, ev: EventView): boolean {
  return rule.enabled && rule.eventType === ev.eventType && rule.conditions.every((c) => conditionMatches(c, ev));
}
