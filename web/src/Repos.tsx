import { useCallback, useEffect, useState } from 'react'
import {
  UnauthenticatedError, connectRepo, disconnectRepo, fetchRepos, setRepoEnabled,
  type Me, type ReposResponse,
} from './api'

export default function Repos({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [data, setData] = useState<ReposResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const handle = useCallback((e: unknown) => {
    if (e instanceof UnauthenticatedError) onSignedOut()
    else setError((e as Error).message)
  }, [onSignedOut])

  const load = useCallback(() => fetchRepos().then(setData).catch(handle), [handle])
  useEffect(() => { void load() }, [load])

  async function run(repoId: number, action: () => Promise<unknown>) {
    setBusy(repoId); setError(null)
    try { await action(); await load() } catch (e) { handle(e) } finally { setBusy(null) }
  }

  if (!data) return <p>{error ? <span role="alert" className="error">{error}</span> : 'Loading repositories…'}</p>

  return (
    <section>
      {error && <p role="alert" className="error">{error}</p>}

      <h2>Connected repositories</h2>
      {data.connected.length === 0 && <p className="muted">None yet. Connect one below.</p>}
      <ul className="repos">
        {data.connected.map((r) => (
          <li key={r.id}>
            <span className="name">{r.fullName}</span>
            <span className={r.enabled ? 'tag on' : 'tag off'}>{r.enabled ? 'active' : 'paused'}</span>
            <button disabled={busy === r.id} onClick={() => run(r.id, () => setRepoEnabled(me.csrfToken, r.id, !r.enabled))}>
              {r.enabled ? 'Pause' : 'Resume'}
            </button>
            <button className="danger" disabled={busy === r.id}
              onClick={() => confirm(`Disconnect ${r.fullName}? Its rules and history will be deleted.`) &&
                run(r.id, () => disconnectRepo(me.csrfToken, r.id))}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>

      <h2>Available repositories</h2>
      {data.installations.length === 0 ? (
        <p>The app isn't installed anywhere yet. <a href={me.installUrl}>Install it on your repositories →</a></p>
      ) : (
        <>
          {data.available.length === 0 && <p className="muted">Every repo the app can see is already connected.</p>}
          <ul className="repos">
            {data.available.map((r) => (
              <li key={r.id}>
                <span className="name">{r.fullName}{r.private && <em> (private)</em>}</span>
                <button disabled={!r.canConnect || busy === r.id}
                  title={r.canConnect ? undefined : 'You need admin access to connect this repository'}
                  onClick={() => run(r.id, () => connectRepo(me.csrfToken, { installationId: r.installationId, repoId: r.id }))}>
                  Connect
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">Don't see a repo? <a href={me.installUrl}>Add it to the app installation</a>, then <button className="link" onClick={() => void load()}>refresh</button>.</p>
        </>
      )}
    </section>
  )
}
