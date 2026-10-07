// Typed client for the backend. Same-origin, cookie-authenticated; mutating calls carry the CSRF token.

export interface Me {
  user: { id: number; login: string; name: string | null; avatarUrl: string | null }
  csrfToken: string
  installUrl: string
}

export type EventStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead'
export type EventType = 'issues' | 'pull_request' | 'push'

export interface AiTriage { summary: string; priority: 'low' | 'medium' | 'high' | 'critical'; label: string | null }
export interface EventAction {
  id: number; type: string; status: 'success' | 'failed' | 'skipped'; attempt: number; error: string | null
  detail: Record<string, unknown> | null; ruleName: string | null; createdAt: string
}
export interface EventItem {
  id: number; repoId: number; repo: string; eventType: EventType; action: string | null; title: string
  author: string; url: string | null; status: EventStatus; attempts: number; lastError: string | null
  receivedAt: string; processedAt: string | null; nextAttemptAt: string; ai: AiTriage | null; actions: EventAction[]
}
export interface EventsPage { events: EventItem[]; nextCursor: number | null }
export type Stats = Record<EventStatus | 'total', number>

export interface ConnectedRepo { id: number; installationId: number; fullName: string; enabled: boolean }
export interface AvailableRepo { id: number; fullName: string; private: boolean; installationId: number; canConnect: boolean }
export interface ReposResponse { connected: ConnectedRepo[]; available: AvailableRepo[]; installations: { id: number; account: string }[] }

export type ConditionField = 'title' | 'body' | 'author' | 'label' | 'branch'
export type ConditionOp = 'contains' | 'not_contains' | 'equals' | 'starts_with'
export interface Condition { field: ConditionField; op: ConditionOp; value: string }
export type RuleAction =
  | { type: 'add_label'; label: string }
  | { type: 'comment'; body: string }
  | { type: 'slack' }
  | { type: 'add_ai_label' }
export interface RuleInput { name: string; enabled: boolean; eventType: EventType; conditions: Condition[]; actions: RuleAction[]; useAi: boolean }
export interface Rule extends RuleInput { id: number; repoId: number }

/** Session is gone/expired: the app returns to the sign-in page. */
export class UnauthenticatedError extends Error {}
export class ApiError extends Error {
  status: number
  issues: { path: (string | number)[]; message: string }[]
  constructor(message: string, status: number, issues: { path: (string | number)[]; message: string }[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

let csrfToken = ''
export const setCsrfToken = (t: string) => { csrfToken = t }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrfToken)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (res.status === 401) throw new UnauthenticatedError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.issues)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

// auth
export const fetchMe = () => request<Me>('/api/me')
export const logout = () => request<void>('/auth/logout', send('POST'))

// events
export interface EventFilters { repoId?: number; status?: EventStatus; type?: EventType }
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
export const fetchEvents = (f: EventFilters, cursor?: number) => request<EventsPage>(`/api/events${qs({ ...f, cursor, limit: 25 })}`)
export const fetchStats = (repoId?: number) => request<Stats>(`/api/events/stats${qs({ repoId })}`)
export const retryEvent = (id: number) => request<{ ok: boolean }>(`/api/events/${id}/retry`, send('POST'))

// repos
export const fetchConnectedRepos = () => request<{ connected: ConnectedRepo[] }>('/api/repos/connected').then((r) => r.connected)
export const fetchRepos = () => request<ReposResponse>('/api/repos')
export const connectRepo = (r: { installationId: number; repoId: number }) => request('/api/repos', send('POST', r))
export const setRepoEnabled = (id: number, enabled: boolean) => request(`/api/repos/${id}`, send('PATCH', { enabled }))
export const disconnectRepo = (id: number) => request(`/api/repos/${id}`, send('DELETE'))

// rules
export const fetchRules = (repoId: number) => request<{ rules: Rule[] }>(`/api/repos/${repoId}/rules`).then((r) => r.rules)
export const createRule = (repoId: number, r: RuleInput) => request(`/api/repos/${repoId}/rules`, send('POST', r))
export const updateRule = (repoId: number, id: number, r: RuleInput) => request(`/api/repos/${repoId}/rules/${id}`, send('PUT', r))
export const deleteRule = (repoId: number, id: number) => request(`/api/repos/${repoId}/rules/${id}`, send('DELETE'))

// settings
export const fetchSlackStatus = () => request<{ configured: boolean }>('/api/settings/slack')
export const saveSlackWebhook = (webhookUrl: string) => request('/api/settings/slack', send('PUT', { webhookUrl }))
export const removeSlackWebhook = () => request('/api/settings/slack', send('DELETE'))
export const testSlack = () => request<{ ok: boolean }>('/api/settings/slack/test', send('POST'))
