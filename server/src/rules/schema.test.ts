import { describe, expect, it } from "vitest";
import { ruleInputSchema } from "./schema.js";

const ok = {
  name: "bugs", eventType: "issues",
  conditions: [{ field: "title", op: "contains", value: "bug" }],
  actions: [{ type: "add_label", label: "bug" }, { type: "slack" }],
};

describe("ruleInputSchema", () => {
  it("accepts a valid rule and applies defaults", () => {
    const r = ruleInputSchema.parse(ok);
    expect(r.enabled).toBe(true);
    expect(r.useAi).toBe(false);
  });
  it("requires at least one action", () => {
    expect(ruleInputSchema.safeParse({ ...ok, actions: [] }).success).toBe(false);
  });
  it("rejects unknown fields/ops/actions/event types", () => {
    expect(ruleInputSchema.safeParse({ ...ok, conditions: [{ field: "title", op: "regex", value: "x" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, conditions: [{ field: "secret", op: "equals", value: "x" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, actions: [{ type: "delete_repo" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, eventType: "release" }).success).toBe(false);
  });
  it("bounds sizes", () => {
    expect(ruleInputSchema.safeParse({ ...ok, name: "x".repeat(101) }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, actions: [{ type: "comment", body: "x".repeat(2001) }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, conditions: Array(11).fill(ok.conditions[0]) }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...ok, conditions: [{ field: "title", op: "equals", value: "  " }] }).success).toBe(false);
  });
  it("push rules may only notify Slack", () => {
    expect(ruleInputSchema.safeParse({ name: "p", eventType: "push", actions: [{ type: "slack" }] }).success).toBe(true);
    expect(ruleInputSchema.safeParse({ name: "p", eventType: "push", actions: [{ type: "add_label", label: "x" }] }).success).toBe(false);
  });
  it("rejects conditions that cannot exist for the event type", () => {
    expect(ruleInputSchema.safeParse({ ...ok, conditions: [{ field: "branch", op: "equals", value: "main" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ name: "p", eventType: "push", actions: [{ type: "slack" }], conditions: [{ field: "label", op: "equals", value: "x" }] }).success).toBe(false);
  });
});
