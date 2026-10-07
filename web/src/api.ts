export interface Me {
  user: { id: number; login: string; name: string | null; avatarUrl: string | null }
  csrfToken: string
  installUrl: string
}

export interface ConnectedRepo { id: number; installationId: number; fullName: string; enabled: boolean }
export interface AvailableRepo { id: number; fullName: string; private: boolean; installationId: number; canConnect: boolean }
export interface ReposResponse {
  connected: ConnectedRepo[]
  available: AvailableRepo[]
  installations: { id: number; account: string }[]
}

/** Thrown when the session is gone/expired; the app returns to the sign-in page. */
export class UnauthenticatedError extends Error {}

async function request<T>(path: string, init: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken) // required on every mutating call
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (res.status === 401) throw new UnauthenticatedError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Returns the logged-in user, or null if there is no valid session. */
export const fetchMe = () => request<Me>('/api/me').catch((e) => (e instanceof UnauthenticatedError ? null : Promise.reject(e)))
export const logout = (csrf: string) => request<void>('/auth/logout', { method: 'POST' }, csrf)

export const fetchRepos = () => request<ReposResponse>('/api/repos')
export const connectRepo = (csrf: string, r: { installationId: number; repoId: number }) =>
  request('/api/repos', { method: 'POST', body: JSON.stringify(r) }, csrf)
export const setRepoEnabled = (csrf: string, id: number, enabled: boolean) =>
  request(`/api/repos/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }, csrf)
export const disconnectRepo = (csrf: string, id: number) => request(`/api/repos/${id}`, { method: 'DELETE' }, csrf)
