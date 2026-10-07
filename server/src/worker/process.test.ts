import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rule } from "../rules/schema.js";
import { actionKey, processEvent, type ProcessDeps } from "./process.js";
import { ActionError, type EventRow, type Executors } from "./types.js";

const event = (over: Partial<EventRow> = {}): EventRow => ({
  id: 1, repoId: 42, eventType: "issues", action: "opened", title: "Login bug", author: "alice",
  url: "https://x", payload: { body: "crashes", labels: [] }, attempts: 1, ...over,
});
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 10, repoId: 42, name: "bugs", enabled: true, eventType: "issues",
  conditions: [{ field: "title", op: "contains", value: "bug" }],
  actions: [{ type: "add_label", label: "bug" }, { type: "slack" }],
  useAi: false, createdAt: new Date(), ...over,
});

let executors: { [K in keyof Executors]: ReturnType<typeof vi.fn> };
let recorded: Parameters<ProcessDeps["recordAction"]>[0][];
let succeeded: Set<string>;
let rules: Rule[];
let deps: ProcessDeps;

beforeEach(() => {
  executors = { add_label: vi.fn().mockResolvedValue({ detail: { ok: 1 } }), comment: vi.fn().mockResolvedValue(undefined), slack: vi.fn().mockResolvedValue(undefined) };
  recorded = [];
  succeeded = new Set();
  rules = [rule()];
  deps = {
    loadRules: async () => rules,
    executors: executors as unknown as Executors,
    hasSucceeded: async (_id, key) => succeeded.has(key),
    recordAction: async (a) => {
      recorded.push(a);
      if (a.status === "success") succeeded.add(a.actionKey);
    },
  };
});

describe("processEvent", () => {
  it("does nothing (done) when no rule matches", async () => {
    expect(await processEvent(event({ title: "Feature request" }), deps)).toEqual({ status: "done" });
    expect(executors.add_label).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("runs all actions of matching rules in order and records each", async () => {
    expect(await processEvent(event(), deps)).toEqual({ status: "done" });
    expect(executors.add_label).toHaveBeenCalledTimes(1);
    expect(executors.slack).toHaveBeenCalledTimes(1);
    expect(recorded.map((r) => [r.type, r.status])).toEqual([["add_label", "success"], ["slack", "success"]]);
    expect(recorded[0]!.detail).toEqual({ ok: 1 });
  });

  it("records 'skipped' (not success) for dry-run results", async () => {
    executors.add_label.mockResolvedValue({ skipped: "dry run" });
    await processEvent(event(), deps);
    expect(recorded[0]).toMatchObject({ status: "skipped", detail: { reason: "dry run" } });
    expect(succeeded.size).toBe(1); // only slack counted as success
  });

  it("only evaluates rules that match this event", async () => {
    rules = [rule({ id: 1, conditions: [{ field: "title", op: "contains", value: "crash" }] }), rule({ id: 2 })];
    await processEvent(event(), deps);
    expect(recorded.every((r) => r.ruleId === 2)).toBe(true);
  });

  describe("idempotency: reprocessing the same event", () => {
    it("never repeats an action that already succeeded", async () => {
      await processEvent(event(), deps);
      await processEvent(event({ attempts: 2 }), deps);
      expect(executors.add_label).toHaveBeenCalledTimes(1);
      expect(executors.slack).toHaveBeenCalledTimes(1);
    });

    it("on retry, only redoes the action that failed", async () => {
      executors.slack.mockRejectedValueOnce(new ActionError("slack 503", true));
      const first = await processEvent(event(), deps);
      expect(first).toMatchObject({ status: "retry" });
      expect(executors.add_label).toHaveBeenCalledTimes(1);

      const second = await processEvent(event({ attempts: 2 }), deps);
      expect(second).toEqual({ status: "done" });
      expect(executors.add_label).toHaveBeenCalledTimes(1); // label NOT applied twice
      expect(executors.slack).toHaveBeenCalledTimes(2);
      expect(recorded.map((r) => `${r.type}:${r.status}:${r.attempt}`)).toEqual([
        "add_label:success:1", "slack:failed:1", "slack:success:2",
      ]);
    });

    it("keys are stable per rule+action and distinguish labels", () => {
      expect(actionKey({ id: 3 }, { type: "add_label", label: "Bug" })).toBe("rule:3:add_label:bug");
      expect(actionKey({ id: 3 }, { type: "add_label", label: "urgent" })).not.toBe(actionKey({ id: 3 }, { type: "add_label", label: "bug" }));
      expect(actionKey({ id: 3 }, { type: "slack" })).not.toBe(actionKey({ id: 4 }, { type: "slack" }));
    });
  });

  describe("failures", () => {
    it("one failing action does not stop the others", async () => {
      executors.add_label.mockRejectedValue(new ActionError("GitHub 503", true));
      const out = await processEvent(event(), deps);
      expect(out).toMatchObject({ status: "retry" });
      expect(executors.slack).toHaveBeenCalledTimes(1);
      expect(recorded.find((r) => r.type === "add_label")).toMatchObject({ status: "failed", error: "GitHub 503", detail: { retryable: true } });
    });

    it("treats unknown errors as retryable", async () => {
      executors.slack.mockRejectedValue(new Error("socket hang up"));
      expect(await processEvent(event(), deps)).toMatchObject({ status: "retry", error: expect.stringContaining("socket hang up") });
    });

    it("goes straight to dead when the failure cannot be fixed by retrying", async () => {
      executors.add_label.mockRejectedValue(new ActionError("GitHub 404: not found", false));
      expect(await processEvent(event(), deps)).toMatchObject({ status: "dead" });
    });

    it("retries if ANY failure is retryable, even when another is permanent", async () => {
      executors.add_label.mockRejectedValue(new ActionError("404", false));
      executors.slack.mockRejectedValue(new ActionError("503", true));
      expect(await processEvent(event(), deps)).toMatchObject({ status: "retry" });
    });

    it("gives up (dead) after the last allowed attempt", async () => {
      executors.slack.mockRejectedValue(new ActionError("still down", true));
      expect(await processEvent(event({ attempts: 5 }), deps)).toMatchObject({ status: "dead" });
    });

    it("propagates infrastructure errors (e.g. cannot load rules) so the worker can retry the event", async () => {
      deps.loadRules = async () => { throw new Error("db down"); };
      await expect(processEvent(event(), deps)).rejects.toThrow("db down");
    });
  });
});
