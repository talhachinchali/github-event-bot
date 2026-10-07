export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

export const fullTime = (iso: string) => new Date(iso).toLocaleString()

export function duration(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso)
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}
