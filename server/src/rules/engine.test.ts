import { describe, expect, it } from "vitest";
import { conditionMatches, ruleMatches, viewOf, type EventView } from "./engine.js";
import type { Condition } from "./schema.js";

const issue: EventView = {
  eventType: "issues", action: "opened", title: "Login BUG on Safari", author: "Alice",
  body: "Steps to reproduce: click login", labels: ["help wanted", "Urgent"], branch: null,
};
const c = (field: Condition["field"], op: Condition["op"], value: string): Condition => ({ field, op, value });

describe("conditionMatches", () => {
  it("contains is case-insensitive", () => {
    expect(conditionMatches(c("title", "contains", "bug"), issue)).toBe(true);
    expect(conditionMatches(c("title", "contains", "crash"), issue)).toBe(false);
  });
  it("equals / starts_with / not_contains", () => {
    expect(conditionMatches(c("author", "equals", "alice"), issue)).toBe(true);
    expect(conditionMatches(c("author", "equals", "ali"), issue)).toBe(false);
    expect(conditionMatches(c("title", "starts_with", "login"), issue)).toBe(true);
    expect(conditionMatches(c("title", "not_contains", "crash"), issue)).toBe(true);
    expect(conditionMatches(c("title", "not_contains", "bug"), issue)).toBe(false);
  });
  it("matches body", () => {
    expect(conditionMatches(c("body", "contains", "reproduce"), issue)).toBe(true);
  });
  it("label: positive ops match ANY label, negative ops require NO label to match", () => {
    expect(conditionMatches(c("label", "equals", "urgent"), issue)).toBe(true);
    expect(conditionMatches(c("label", "contains", "help"), issue)).toBe(true);
    expect(conditionMatches(c("label", "equals", "bug"), issue)).toBe(false);
    expect(conditionMatches(c("label", "not_contains", "urgent"), issue)).toBe(false);
    expect(conditionMatches(c("label", "not_contains", "bug"), issue)).toBe(true);
    expect(conditionMatches(c("label", "not_contains", "bug"), { ...issue, labels: [] })).toBe(true);
    expect(conditionMatches(c("label", "equals", "bug"), { ...issue, labels: [] })).toBe(false);
  });
  it("branch never matches when the event has no branch", () => {
    expect(conditionMatches(c("branch", "equals", "main"), issue)).toBe(false);
    expect(conditionMatches(c("branch", "not_contains", "main"), issue)).toBe(false);
    expect(conditionMatches(c("branch", "equals", "main"), { ...issue, eventType: "push", branch: "main" })).toBe(true);
  });
  it("treats special characters literally (no regex)", () => {
    const ev = { ...issue, title: "a.b (c)" };
    expect(conditionMatches(c("title", "contains", "a.b (c)"), ev)).toBe(true);
    expect(conditionMatches(c("title", "contains", ".*"), ev)).toBe(false);
    expect(conditionMatches(c("title", "contains", "(a+)+$"), ev)).toBe(false);
  });
});

describe("ruleMatches", () => {
  const rule = (over = {}) => ({ enabled: true, eventType: "issues" as const, conditions: [], ...over });
  it("no conditions = every event of that type", () => {
    expect(ruleMatches(rule(), issue)).toBe(true);
  });
  it("requires ALL conditions", () => {
    const both = [c("title", "contains", "bug"), c("author", "equals", "alice")];
    expect(ruleMatches(rule({ conditions: both }), issue)).toBe(true);
    expect(ruleMatches(rule({ conditions: [...both, c("body", "contains", "nope")] }), issue)).toBe(false);
  });
  it("ignores disabled rules and other event types", () => {
    expect(ruleMatches(rule({ enabled: false }), issue)).toBe(false);
    expect(ruleMatches(rule({ eventType: "pull_request" }), issue)).toBe(false);
  });
});

describe("viewOf", () => {
  it("extracts fields per event type", () => {
    expect(viewOf({ eventType: "push", action: null, title: "t", author: "a", payload: { branch: "main" } }).branch).toBe("main");
    expect(viewOf({ eventType: "pull_request", action: "opened", title: "t", author: "a", payload: { base: "dev", labels: ["x", 5] } })).toMatchObject({ branch: "dev", labels: ["x"] });
    expect(viewOf({ eventType: "issues", action: "opened", title: "t", author: "a", payload: {} })).toMatchObject({ branch: null, body: "", labels: [] });
  });
});
