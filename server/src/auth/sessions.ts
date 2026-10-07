import { query } from "../db/index.js";
import { encrypt, randomToken, sha256 } from "./crypto.js";
import type { GitHubUser } from "./github-oauth.js";

const MAX_SESSION_SECONDS = 7 * 24 * 3600;

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  ghTokenEnc: string | null;
  user: { id: number; login: string; name: string | null; avatarUrl: string | null };
}

export async function upsertUser(u: GitHubUser): Promise<void> {
  await query(
    `INSERT INTO users (id, login, name, avatar_url) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET login = $2, name = $3, avatar_url = $4, updated_at = now()`,
    [u.id, u.login, u.name, u.avatar_url],
  );
}

/** Creates a session. Only a hash of the returned token is stored. The session never outlives the GitHub user token. */
export async function createSession(opts: { userId: number; ghToken: string; tokenTtlSeconds: number }) {
  const token = randomToken();
  const csrfToken = randomToken();
  const ttl = Math.min(opts.tokenTtlSeconds, MAX_SESSION_SECONDS);
  const { rows } = await query<{ expires_at: Date }>(
    `INSERT INTO sessions (id, user_id, csrf_token, gh_token_enc, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING expires_at`,
    [sha256(token), opts.userId, csrfToken, encrypt(opts.ghToken), ttl],
  );
  return { token, maxAgeMs: ttl * 1000, expiresAt: rows[0]!.expires_at };
}

export async function findSession(token: string): Promise<AuthContext | null> {
  const { rows } = await query<{
    id: string; csrf_token: string; gh_token_enc: string | null;
    user_id: number; login: string; name: string | null; avatar_url: string | null;
  }>(
    `SELECT s.id, s.csrf_token, s.gh_token_enc, u.id AS user_id, u.login, u.name, u.avatar_url
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    sessionId: r.id,
    csrfToken: r.csrf_token,
    ghTokenEnc: r.gh_token_enc,
    user: { id: r.user_id, login: r.login, name: r.name, avatarUrl: r.avatar_url },
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function purgeExpiredSessions(): Promise<number> {
  const r = await query("DELETE FROM sessions WHERE expires_at <= now()");
  return r.rowCount ?? 0;
}
