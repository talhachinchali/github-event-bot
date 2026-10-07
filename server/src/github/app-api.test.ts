import { createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A real RSA key must exist BEFORE config.ts is evaluated, because default JWT signing reads it from config.
const { publicKey, privateKey } = vi.hoisted(() => {
  const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.GITHUB_APP_PRIVATE_KEY = keys.privateKey.replace(/\n/g, "\\n"); // single-line form, like .env
  return keys;
});

import { ActionError } from "../worker/types.js";
import {
  addLabel, classifyError, clearTokenCache, commentMarker, createAppJwt, getInstallationToken,
  listRecentDeliveries, postCommentOnce, redeliver,
} from "./app-api.js";

describe("createAppJwt", () => {
  it("is a valid RS256 JWT with the right claims", () => {
    const now = 1_800_000_000_000;
    const jwt = createAppJwt({ appId: "12345", privateKey, now: () => now });
    const [h, p, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: "12345" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
  it("lifetime stays under GitHub's 10 minute limit", () => {
    const [, p] = createAppJwt({ appId: "1", privateKey }).split(".") as [string, string];
    const c = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(c.exp - c.iat).toBeLessThanOrEqual(600);
  });
});

describe("classifyError", () => {
  const res = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) });
  it.each([[500], [502], [503], [429], [401], [408]])("HTTP %i is retryable", (s) => {
    expect(classifyError("x", res(s)).retryable).toBe(true);
  });
  it.each([[404], [422], [403], [400]])("HTTP %i is permanent", (s) => {
    expect(classifyError("x", res(s)).retryable).toBe(false);
  });
  it("403 with rate-limit headers is retryable", () => {
    expect(classifyError("x", res(403, { "x-ratelimit-remaining": "0" })).retryable).toBe(true);
    expect(classifyError("x", res(403, { "retry-after": "30" })).retryable).toBe(true);
  });
});

// ---- fetch-stubbed API behaviour ----
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
let calls: Call[];
let responder: (c: Call) => { status: number; body?: unknown; headers?: Record<string, string> } | Error;

beforeEach(() => {
  calls = [];
  clearTokenCache();
  responder = () => ({ status: 200, body: {} });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call: Call = { url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const r = responder(call);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  });
});
afterEach(() => vi.unstubAllGlobals());

const tokenResponse = (expiresInMs = 3_600_000, token = "ghs_installtoken") =>
  ({ status: 201, body: { token, expires_at: new Date(Date.now() + expiresInMs).toISOString() } });
const isTokenCall = (c: Call) => c.url.endsWith("/access_tokens");

describe("getInstallationToken", () => {
  it("exchanges an app JWT for a token and caches it", async () => {
    responder = () => tokenResponse();
    expect(await getInstallationToken(7)).toBe("ghs_installtoken");
    expect(await getInstallationToken(7)).toBe("ghs_installtoken");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/app/installations/7/access_tokens");
    expect(calls[0]!.headers.Authorization).toMatch(/^Bearer eyJ/); // a JWT, not a stored secret
  });
  it("caches per installation", async () => {
    responder = () => tokenResponse();
    await getInstallationToken(1);
    await getInstallationToken(2);
    expect(calls).toHaveLength(2);
  });
  it("refreshes a token that is about to expire", async () => {
    responder = () => tokenResponse(60_000); // expires in 1 min: inside the 5 min refresh margin
    await getInstallationToken(7);
    await getInstallationToken(7);
    expect(calls).toHaveLength(2);
  });
  it("surfaces failures as ActionErrors without leaking secrets", async () => {
    responder = () => ({ status: 404, body: { message: "Not Found" } });
    const err = await getInstallationToken(7).catch((e) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect(err.retryable).toBe(false);
    expect(err.message).not.toMatch(/Bearer|eyJ|PRIVATE KEY/);
  });
});

describe("addLabel", () => {
  it("POSTs the label with the installation token", async () => {
    responder = (c) => (isTokenCall(c) ? tokenResponse() : { status: 200, body: [] });
    const out = await addLabel(7, "me/app", 5, "bug");
    expect(out).toEqual({ label: "bug" });
    const call = calls.find((c) => c.url.includes("/labels"))!;
    expect(call.url).toBe("https://api.github.com/repos/me/app/issues/5/labels");
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body!)).toEqual({ labels: ["bug"] });
    expect(call.headers.Authorization).toBe("Bearer ghs_installtoken");
  });
  it("classifies a 404 as permanent and a 503 as transient", async () => {
    responder = (c) => (isTokenCall(c) ? tokenResponse() : { status: 404 });
    expect(await addLabel(7, "me/app", 5, "bug").catch((e) => e)).toMatchObject({ retryable: false });
    responder = (c) => (isTokenCall(c) ? tokenResponse() : { status: 503 });
    expect(await addLabel(7, "me/app", 5, "bug").catch((e) => e)).toMatchObject({ retryable: true });
  });
  it("treats a network failure as transient", async () => {
    responder = (c) => (isTokenCall(c) ? tokenResponse() : new Error("ECONNRESET"));
    expect(await addLabel(7, "me/app", 5, "bug").catch((e) => e)).toMatchObject({ retryable: true });
  });
  it("drops the cached token after a 401 so the retry mints a fresh one", async () => {
    let n = 0;
    responder = (c) => (isTokenCall(c) ? tokenResponse(3_600_000, `ghs_${++n}`) : { status: 401 });
    await addLabel(7, "me/app", 5, "bug").catch(() => undefined);
    responder = (c) => (isTokenCall(c) ? tokenResponse(3_600_000, `ghs_${++n}`) : { status: 200, body: [] });
    await addLabel(7, "me/app", 5, "bug");
    expect(calls.filter(isTokenCall)).toHaveLength(2);
  });
  it.each(["me/app/../../admin", "me", "../x", "./x", "me/..", "me/.", "me/app?x=1", "me/app#frag", "a b/c", ""])(
    "refuses a repo name that could alter the request path: %j",
    async (name) => {
      responder = (c) => (isTokenCall(c) ? tokenResponse() : { status: 200 });
      const err = await addLabel(7, name, 5, "bug").catch((e) => e);
      expect(err).toMatchObject({ retryable: false, message: "invalid repository name" });
      expect(calls.some((c) => c.url.includes("/labels"))).toBe(false);
    },
  );
});

describe("repo name validation (positive cases)", () => {
  it.each(["me/.github", "My-Org/my.repo_name-1", "a/b"])("accepts %s", async (name) => {
    responder = (c) => (isTokenCall(c) ? tokenResponse() : { status: 200, body: [] });
    await expect(addLabel(7, name, 1, "bug")).resolves.toEqual({ label: "bug" });
  });
});

describe("postCommentOnce", () => {
  const marker = commentMarker(11, 22);
  it("builds a stable hidden marker", () => {
    expect(marker).toBe("<!-- repo-sentinel:event=11:rule=22 -->");
  });
  it("posts the comment with the marker appended", async () => {
    responder = (c) => {
      if (isTokenCall(c)) return tokenResponse();
      if (c.method === "GET") return { status: 200, body: [{ body: "unrelated" }] };
      return { status: 201, body: { id: 99, html_url: "https://github.com/me/app/issues/5#issuecomment-99" } };
    };
    const out = await postCommentOnce(7, "me/app", 5, "Thanks for reporting!", marker);
    expect(out).toEqual({ commentId: 99, url: "https://github.com/me/app/issues/5#issuecomment-99" });
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/comments"))!;
    expect(JSON.parse(post.body!).body).toBe(`Thanks for reporting!\n\n${marker}`);
  });
  it("does NOT post again if a previous attempt already did (marker found)", async () => {
    responder = (c) =>
      isTokenCall(c) ? tokenResponse() : { status: 200, body: [{ body: `Thanks!\n\n${marker}` }] };
    expect(await postCommentOnce(7, "me/app", 5, "Thanks!", marker)).toEqual({ alreadyPosted: true });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/comments"))).toBe(false);
  });
  it("a marker for a different rule/event does not suppress the comment", async () => {
    responder = (c) => {
      if (isTokenCall(c)) return tokenResponse();
      if (c.method === "GET") return { status: 200, body: [{ body: commentMarker(11, 99) }] };
      return { status: 201, body: { id: 1 } };
    };
    expect(await postCommentOnce(7, "me/app", 5, "hi", marker)).toMatchObject({ commentId: 1 });
  });
  it("fails (retryable) if it cannot check existing comments, rather than risk a duplicate", async () => {
    responder = (c) => (isTokenCall(c) ? tokenResponse() : { status: 502 });
    expect(await postCommentOnce(7, "me/app", 5, "hi", marker).catch((e) => e)).toMatchObject({ retryable: true });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/comments"))).toBe(false);
  });
});

describe("webhook deliveries", () => {
  it("lists deliveries and redelivers using the app JWT", async () => {
    responder = (c) => (c.method === "GET" ? { status: 200, body: [{ id: 1, guid: "g", delivered_at: "x", redelivery: false, status_code: 502, event: "issues" }] } : { status: 202 });
    expect(await listRecentDeliveries()).toHaveLength(1);
    await redeliver(1);
    expect(calls[0]!.url).toBe("https://api.github.com/app/hook/deliveries?per_page=100");
    expect(calls[1]!.url).toBe("https://api.github.com/app/hook/deliveries/1/attempts");
    expect(calls[1]!.method).toBe("POST");
    expect(calls.every((c) => c.headers.Authorization?.startsWith("Bearer eyJ"))).toBe(true);
  });
});
