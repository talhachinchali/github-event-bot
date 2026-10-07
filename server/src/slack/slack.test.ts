import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "../worker/types.js";
import { escapeSlack, isValidSlackWebhookUrl, sendSlack } from "./client.js";
import { buildMessage } from "./message.js";

// Assembled at runtime so no secret-shaped literal sits in the source (GitHub push protection flags those).
const GOOD = ["https://hooks.slack", ".com/services/", "T00000000/", "B00000000/", "X".repeat(24)].join("");

describe("isValidSlackWebhookUrl (SSRF guard)", () => {
  it("accepts a real webhook URL", () => {
    expect(isValidSlackWebhookUrl(GOOD)).toBe(true);
  });
  it.each([
    ["http scheme", GOOD.replace("https", "http")],
    ["other host", "https://evil.com/services/T0/B0/X"],
    ["lookalike subdomain suffix", "https://hooks.slack.com.evil.com/services/T0/B0/X"],
    ["lookalike prefix", "https://evilhooks.slack.com/services/T0/B0/X"],
    ["userinfo trick", "https://hooks.slack.com@evil.com/services/T0/B0/X"],
    ["host in query", "https://evil.com/?https://hooks.slack.com/services/T0/B0/X"],
    ["host in path", "https://evil.com/https://hooks.slack.com/services/T0/B0/X"],
    ["port", "https://hooks.slack.com:8443/services/T0/B0/X"],
    ["query string", GOOD + "?x=1"],
    ["fragment", GOOD + "#x"],
    ["trailing path", GOOD + "/extra"],
    ["path traversal", "https://hooks.slack.com/services/../../x/y/z"],
    ["localhost", "http://localhost:3000/services/T0/B0/X"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["newline injection", GOOD + "\nHost: evil.com"],
    ["leading space", " " + GOOD],
    ["empty", ""],
  ])("rejects %s", (_n, url) => {
    expect(isValidSlackWebhookUrl(url)).toBe(false);
  });
});

describe("escapeSlack", () => {
  it("neutralizes mentions and links", () => {
    expect(escapeSlack("<!channel> <@U123> <https://evil.com|click> & more")).toBe(
      "&lt;!channel&gt; &lt;@U123&gt; &lt;https://evil.com|click&gt; &amp; more",
    );
  });
});

describe("buildMessage", () => {
  const issue = { eventType: "issues" as const, action: "opened", title: "Login bug", author: "alice", url: "https://github.com/me/app/issues/5", repo: "me/app", number: 5 };
  it("formats an issue with a link", () => {
    const m = buildMessage(issue);
    expect(m.text).toContain("*me/app*: Issue opened by alice");
    expect(m.text).toContain("<https://github.com/me/app/issues/5|#5 Login bug>");
  });
  it("formats a pull request", () => {
    expect(buildMessage({ ...issue, eventType: "pull_request", number: 9 }).text).toContain("Pull request opened");
  });
  it("formats a push with branch and commit count", () => {
    const m = buildMessage({ eventType: "push", action: null, title: "fix thing", author: "carol", url: null, repo: "me/app", branch: "main", commitCount: 3 });
    expect(m.text).toContain("3 commits pushed to `main` by carol");
    expect(buildMessage({ eventType: "push", action: null, title: "x", author: "c", url: null, repo: "r", branch: "main", commitCount: 1 }).text).toContain("1 commit pushed");
  });
  it("escapes attacker-controlled text (title, author, repo, summary)", () => {
    const m = buildMessage({ ...issue, title: "<!channel> hi", author: "<@U1>", repo: "a/<b>", aiSummary: "<!here> pwn" });
    expect(m.text).not.toMatch(/<!channel>|<@U1>|<!here>|<b>/);
    expect(m.text).toContain("&lt;!channel&gt;");
  });
  it("does not turn a non-GitHub URL into a link", () => {
    const m = buildMessage({ ...issue, url: "https://evil.com/phish|click" });
    expect(m.text).not.toContain("evil.com");
    expect(m.text).toContain("#5 Login bug");
  });
  it("includes AI priority and summary when present", () => {
    const m = buildMessage({ ...issue, aiPriority: "high", aiSummary: "Login crashes on Safari." });
    expect(m.text).toContain("*Priority:* high");
    expect(m.text).toContain("*AI summary:* Login crashes on Safari.");
  });
  it("truncates very long titles", () => {
    expect(buildMessage({ ...issue, title: "x".repeat(5000) }).text.length).toBeLessThan(600);
  });
});

describe("sendSlack", () => {
  let respond: () => Response | Error;
  let lastInit: RequestInit | undefined;
  beforeEach(() => {
    respond = () => new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      lastInit = init;
      const r = respond();
      if (r instanceof Error) throw r;
      return r;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts JSON and never follows redirects", async () => {
    await sendSlack(GOOD, { text: "hi" });
    expect(lastInit?.method).toBe("POST");
    expect(JSON.parse(lastInit!.body as string)).toEqual({ text: "hi" });
    expect(lastInit?.redirect).toBe("error");
  });
  it("refuses a non-Slack URL without making any request", async () => {
    lastInit = undefined;
    await expect(sendSlack("https://evil.com/x", { text: "hi" })).rejects.toMatchObject({ retryable: false });
    expect(lastInit).toBeUndefined();
  });
  it.each([[429], [500], [503]])("HTTP %i is retryable", async (status) => {
    respond = () => new Response("", { status });
    expect(await sendSlack(GOOD, { text: "x" }).catch((e) => e)).toMatchObject({ retryable: true });
  });
  it.each([[400], [403], [404], [410]])("HTTP %i is permanent", async (status) => {
    respond = () => new Response("no_service", { status });
    const err = await sendSlack(GOOD, { text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect(err.retryable).toBe(false);
  });
  it("network errors are retryable and never leak the secret URL", async () => {
    respond = () => new Error(`connect ECONNREFUSED ${GOOD}`);
    const err = await sendSlack(GOOD, { text: "x" }).catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain("hooks.slack.com");
    expect(err.message).not.toContain("XXXX");
  });
});
