import { createSign } from "node:crypto";
import { config } from "../config.js";
import { ActionError } from "../worker/types.js";

// GitHub calls made AS THE APP (JWT -> short-lived installation token). Used for write-back and the reconciler.

const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;
// owner/name only: this string is interpolated into URL paths, so it must not be able to inject path segments.
const REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const b64url = (v: object | Buffer) => Buffer.from(v instanceof Buffer ? v : JSON.stringify(v)).toString("base64url");

/** App JWT (RS256, 9 min lifetime, backdated 60s for clock skew). Proves "I am this GitHub App". */
export function createAppJwt(
  opts: { appId?: string; privateKey?: string; now?: () => number } = {},
): string {
  const now = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  const data = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iat: now - 60, exp: now + 9 * 60, iss: opts.appId ?? config.GITHUB_APP_ID,
  })}`;
  const sig = createSign("RSA-SHA256").update(data).sign(opts.privateKey ?? config.GITHUB_APP_PRIVATE_KEY);
  return `${data}.${b64url(sig)}`;
}

/** Maps a failed GitHub response to an error that says whether retrying could help. */
export function classifyError(what: string, res: { status: number; headers: Headers }): ActionError {
  const { status } = res;
  const rateLimited =
    status === 429 || (status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
  // Transient: server errors, rate limits, and 401 (our cached token may just have expired).
  if (status >= 500 || rateLimited || status === 401 || status === 408) {
    return new ActionError(`${what} failed: HTTP ${status}`, true);
  }
  // 403/404/422...: missing permission, deleted issue/repo, invalid input. Retrying will not fix it.
  return new ActionError(`${what} failed: HTTP ${status}`, false);
}

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<number, CachedToken>();
const REFRESH_MARGIN_MS = 5 * 60_000;

export function clearTokenCache() {
  tokenCache.clear();
}

async function gh(method: string, path: string, auth: string, body?: unknown, what = `${method} ${path.split("?")[0]}`) {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${auth}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-sentinel",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ActionError(`${what} failed: network error or timeout`, true);
  }
  return res;
}

/** Installation access token (valid ~1h), cached in memory and refreshed 5 min before expiry. */
export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

  const what = "create installation token";
  const res = await gh("POST", `/app/installations/${installationId}/access_tokens`, createAppJwt(), undefined, what);
  if (!res.ok) throw classifyError(what, res);
  const body = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: body.token, expiresAt: Date.parse(body.expires_at) });
  return body.token;
}

function repoPath(fullName: string): string {
  // Also reject "." / ".." segments: they are legal characters but would collapse the URL path ("../x").
  const valid = REPO_FULL_NAME.test(fullName) && fullName.split("/").every((seg) => !/^\.+$/.test(seg));
  if (!valid) throw new ActionError("invalid repository name", false);
  return `/repos/${fullName}`;
}

/** Runs a call with an installation token; on 401 drops the cached token so the retry gets a fresh one. */
async function withInstallation<T>(installationId: number, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getInstallationToken(installationId);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof ActionError && err.message.endsWith("HTTP 401")) tokenCache.delete(installationId);
    throw err;
  }
}

/** Adds a label to an issue/PR. Naturally idempotent; GitHub creates the label if it does not exist yet. */
export function addLabel(installationId: number, repoFullName: string, number: number, label: string) {
  return withInstallation(installationId, async (token) => {
    const what = "add label";
    const res = await gh("POST", `${repoPath(repoFullName)}/issues/${number}/labels`, token, { labels: [label] }, what);
    if (!res.ok) throw classifyError(what, res);
    return { label };
  });
}

/** Hidden marker embedded in every bot comment: lets a retry detect "already posted" instead of double-posting. */
export const commentMarker = (eventId: number, ruleId: number) => `<!-- repo-sentinel:event=${eventId}:rule=${ruleId} -->`;

const MAX_COMMENT_PAGES = 3;

export function postCommentOnce(
  installationId: number, repoFullName: string, number: number, body: string, marker: string,
) {
  return withInstallation(installationId, async (token) => {
    const base = `${repoPath(repoFullName)}/issues/${number}/comments`;

    // The comment may already exist if a previous attempt succeeded but we crashed before recording it.
    for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
      const what = "list comments";
      const res = await gh("GET", `${base}?per_page=100&page=${page}`, token, undefined, what);
      if (!res.ok) throw classifyError(what, res);
      const comments = (await res.json()) as { body?: string }[];
      if (comments.some((c) => c.body?.includes(marker))) return { alreadyPosted: true };
      if (comments.length < 100) break;
    }

    const what = "post comment";
    const res = await gh("POST", base, token, { body: `${body}\n\n${marker}` }, what);
    if (!res.ok) throw classifyError(what, res);
    const created = (await res.json()) as { id?: number; html_url?: string };
    return { commentId: created.id, url: created.html_url };
  });
}

// --- webhook deliveries (used by the reconciler; authenticated with the app JWT, not an installation token) ---

export interface HookDelivery {
  id: number;
  guid: string;
  delivered_at: string;
  redelivery: boolean;
  status_code: number;
  event: string;
}

export async function listRecentDeliveries(): Promise<HookDelivery[]> {
  const what = "list webhook deliveries";
  const res = await gh("GET", "/app/hook/deliveries?per_page=100", createAppJwt(), undefined, what);
  if (!res.ok) throw classifyError(what, res);
  return (await res.json()) as HookDelivery[];
}

export async function redeliver(deliveryId: number): Promise<void> {
  const what = "redeliver webhook";
  const res = await gh("POST", `/app/hook/deliveries/${deliveryId}/attempts`, createAppJwt(), undefined, what);
  if (!res.ok) throw classifyError(what, res);
}
