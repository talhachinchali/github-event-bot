// GitHub REST calls made with a *user* token (from the OAuth login).
// App/installation-token calls (bot write-back) live in a separate module.

const TIMEOUT_MS = 10_000;
const PER_PAGE = 100;
const MAX_PAGES = 10; // hard cap: never loop forever on a misbehaving API

export class GitHubApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface GhInstallation {
  id: number;
  account: { login: string; type: string };
  repository_selection: string;
  suspended_at: string | null;
}

export interface GhRepo {
  id: number;
  full_name: string;
  private: boolean;
  permissions?: { admin?: boolean };
}

async function ghGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "repo-sentinel",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Do not include the response body in the error: keep logs free of anything sensitive.
  if (!res.ok) throw new GitHubApiError(res.status, `GitHub API ${path.split("?")[0]} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function paginate<T>(token: string, path: string, key: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await ghGet<Record<string, unknown>>(token, `${path}${sep}per_page=${PER_PAGE}&page=${page}`);
    const items = (body[key] as T[] | undefined) ?? [];
    all.push(...items);
    if (items.length < PER_PAGE) break;
  }
  return all;
}

/** Installations of *this app* that the user can access. */
export const listUserInstallations = (token: string) =>
  paginate<GhInstallation>(token, "/user/installations", "installations");

/** Repos in an installation that are visible to both the user and the app. */
export const listInstallationRepos = (token: string, installationId: number) =>
  paginate<GhRepo>(token, `/user/installations/${installationId}/repositories`, "repositories");
