import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rule } from "../rules/schema.js";
import { createExecutors, type ExecutorDeps } from "./executors.js";
import { renderTemplate } from "./template.js";
import { ActionError, type ActionContext, type EventRow } from "./types.js";

const event = (over: Partial<EventRow> = {}): EventRow => ({
  id: 11, repoId: 42, eventType: "issues", action: "opened", title: "Login bug", author: "alice",
  url: "https://github.com/me/app/issues/5", payload: { number: 5, repo: "evil/attacker-controlled" }, attempts: 1, ...over,
});
const rule: Rule = { id: 22, repoId: 42, name: "r", enabled: true, eventType: "issues", conditions: [], actions: [], useAi: false, createdAt: new Date() };
const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ event: event(), rule, ...over });

let deps: { [K in keyof ExecutorDeps]: ReturnType<typeof vi.fn> };
let ex: ReturnType<typeof createExecutors>;
beforeEach(() => {
  deps = {
    getRepoTarget: vi.fn().mockResolvedValue({ installationId: 7, fullName: "me/app" }),
    getWebhookForRepo: vi.fn().mockResolvedValue("https://hooks.slack.com/services/T0/B0/X"),
    addLabel: vi.fn().mockResolvedValue({ label: "bug" }),
    postCommentOnce: vi.fn().mockResolvedValue({ commentId: 1 }),
    sendSlack: vi.fn().mockResolvedValue(undefined),
  };
  ex = createExecutors(deps as unknown as ExecutorDeps);
});

describe("renderTemplate", () => {
  it("fills known variables and blanks unknown ones", () => {
    expect(renderTemplate("Hi {{author}}, re #{{ number }}: {{title}} {{nope}}!", { author: "al", number: 5, title: "T" })).toBe("Hi al, re #5: T !");
  });
  it("does not evaluate anything or re-expand inserted values", () => {
    expect(renderTemplate("{{title}}", { title: "{{author}} ${process.exit()} <script>" })).toBe("{{author}} ${process.exit()} <script>");
    expect(renderTemplate("{{constructor}} {{__proto__}}", {})).toBe(" ");
  });
});

describe("add_label executor", () => {
  it("labels the issue using the repo and installation from OUR database, not the payload", async () => {
    const out = await ex.add_label({ type: "add_label", label: "bug" }, ctx());
    expect(deps.addLabel).toHaveBeenCalledWith(7, "me/app", 5, "bug");
    expect(out).toEqual({ detail: { label: "bug" } });
  });
  it("is permanent-failure when the repo was disconnected meanwhile", async () => {
    deps.getRepoTarget.mockResolvedValue(null);
    await expect(ex.add_label({ type: "add_label", label: "bug" }, ctx())).rejects.toMatchObject({ retryable: false });
    expect(deps.addLabel).not.toHaveBeenCalled();
  });
  it("cannot act on a push event (no issue number)", async () => {
    const push = ctx({ event: event({ eventType: "push", payload: { branch: "main" } }) });
    await expect(ex.add_label({ type: "add_label", label: "x" }, push)).rejects.toMatchObject({ retryable: false });
  });
  it("propagates GitHub errors unchanged so the worker can decide to retry", async () => {
    deps.addLabel.mockRejectedValue(new ActionError("add label failed: HTTP 503", true));
    await expect(ex.add_label({ type: "add_label", label: "bug" }, ctx())).rejects.toMatchObject({ retryable: true });
  });
});

describe("comment executor", () => {
  it("renders the template and attaches a per-event/rule marker for idempotency", async () => {
    await ex.comment({ type: "comment", body: "Thanks @{{author}} for #{{number}} in {{repo}}" }, ctx());
    const [inst, repo, num, body, marker] = deps.postCommentOnce.mock.calls[0]!;
    expect([inst, repo, num]).toEqual([7, "me/app", 5]);
    expect(body).toBe("Thanks @alice for #5 in me/app");
    expect(marker).toBe("<!-- repo-sentinel:event=11:rule=22 -->");
  });
  it("can include the AI summary when available", async () => {
    await ex.comment({ type: "comment", body: "Summary: {{ai_summary}} ({{ai_priority}})" }, ctx({ ai: { summary: "Crash on login", priority: "high", label: "bug" } }));
    expect(deps.postCommentOnce.mock.calls[0]![3]).toBe("Summary: Crash on login (high)");
  });
  it("caps the rendered comment length", async () => {
    await ex.comment({ type: "comment", body: "{{title}}" }, ctx({ event: event({ title: "x".repeat(9000) }) }));
    expect(deps.postCommentOnce.mock.calls[0]![3].length).toBeLessThanOrEqual(5000);
  });
});

describe("slack executor", () => {
  it("sends a message for the repo owner's webhook", async () => {
    await ex.slack({ type: "slack" }, ctx());
    expect(deps.getWebhookForRepo).toHaveBeenCalledWith(42);
    const [url, message] = deps.sendSlack.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.com/services/T0/B0/X");
    expect(message.text).toContain("me/app");
    expect(message.text).toContain("Login bug");
  });
  it("fails permanently (and visibly) when Slack is not configured", async () => {
    deps.getWebhookForRepo.mockResolvedValue(null);
    const err = await ex.slack({ type: "slack" }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect(err).toMatchObject({ retryable: false });
    expect(err.message).toMatch(/not configured/);
    expect(deps.sendSlack).not.toHaveBeenCalled();
  });
  it("works for push events (no issue number)", async () => {
    const push = ctx({ event: event({ eventType: "push", action: null, payload: { branch: "main", commitCount: 2 }, url: null }) });
    await ex.slack({ type: "slack" }, push);
    expect(deps.sendSlack.mock.calls[0]![1].text).toContain("2 commits pushed to `main`");
  });
  it("transient Slack failures stay retryable", async () => {
    deps.sendSlack.mockRejectedValue(new ActionError("Slack responded HTTP 503", true));
    await expect(ex.slack({ type: "slack" }, ctx())).rejects.toMatchObject({ retryable: true });
  });
});
