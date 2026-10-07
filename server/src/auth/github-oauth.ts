import { createHash } from "node:crypto";
import { config } from "../config.js";

const TIMEOUT_MS = 10_000;
export const REDIRECT_URI = `${config.APP_URL}/auth/github/callback`;

export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export function authorizeUrl(state: string, verifier: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: config.GITHUB_APP_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface TokenResult {
  accessToken: string;
  /** Seconds until the user token expires (GitHub Apps: 8h by default). */
  expiresIn: number;
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResult> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.GITHUB_APP_CLIENT_ID,
      client_secret: config.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  // GitHub answers 200 with an error field for bad codes. Never include the body in errors (may echo secrets).
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!body.access_token) throw new Error(`token exchange rejected: ${body.error ?? "unknown"}`);
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 8 * 3600 };
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "repo-sentinel",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`fetch user failed: HTTP ${res.status}`);
  const u = (await res.json()) as GitHubUser;
  return { id: u.id, login: u.login, name: u.name ?? null, avatar_url: u.avatar_url ?? null };
}
