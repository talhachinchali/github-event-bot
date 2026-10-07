import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/**
 * Subscribes to the server's event stream. The server only sends a data-free "something changed" nudge;
 * we then re-fetch our own (ownership-scoped) data. Returns whether the stream is currently connected.
 * The browser reconnects automatically if the connection drops.
 */
export function useLiveUpdates(): boolean {
  const qc = useQueryClient()
  const [live, setLive] = useState(false)

  useEffect(() => {
    const es = new EventSource('/api/events/stream')
    es.onopen = () => setLive(true)
    es.addEventListener('change', () => {
      void qc.invalidateQueries({ queryKey: ['events'] })
      void qc.invalidateQueries({ queryKey: ['stats'] })
    })
    es.onerror = () => {
      setLive(false)
      // The stream ends when the session expires: re-check who we are (a 401 returns us to the sign-in page).
      void qc.invalidateQueries({ queryKey: ['me'] })
    }
    return () => es.close()
  }, [qc])

  return live
}
