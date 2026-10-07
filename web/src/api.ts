export interface Me {
  user: { id: number; login: string; name: string | null; avatarUrl: string | null }
  csrfToken: string
  installUrl: string
}

/** Returns the logged-in user, or null if there is no valid session. */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch('/api/me', { credentials: 'same-origin' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

/** Mutating calls must carry the per-session CSRF token. */
export async function logout(csrfToken: string): Promise<void> {
  const res = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  if (!res.ok) throw new Error(`Logout failed (${res.status})`)
}
