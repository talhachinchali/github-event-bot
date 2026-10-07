import { useEffect, useState } from 'react'
import { fetchMe, logout, type Me } from './api'

type State = { status: 'loading' } | { status: 'anonymous' } | { status: 'ready'; me: Me } | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const loginFailed = new URLSearchParams(window.location.search).get('error') === 'login_failed'

  useEffect(() => {
    fetchMe()
      .then((me) => setState(me ? { status: 'ready', me } : { status: 'anonymous' }))
      .catch((e: Error) => setState({ status: 'error', message: e.message }))
  }, [])

  if (state.status === 'loading') return <main><p>Loading…</p></main>
  if (state.status === 'error') return <main><p role="alert">Something went wrong: {state.message}</p></main>

  if (state.status === 'anonymous') {
    return (
      <main>
        <h1>Repo Sentinel</h1>
        <p>A GitHub bot that labels, comments and alerts Slack when things happen in your repos.</p>
        {loginFailed && <p role="alert" className="error">Sign-in failed. Please try again.</p>}
        <a className="button" href="/auth/github/login">Sign in with GitHub</a>
      </main>
    )
  }

  const { me } = state
  return (
    <main>
      <header className="bar">
        <h1>Repo Sentinel</h1>
        <span className="who">
          {me.user.avatarUrl && <img src={me.user.avatarUrl} alt="" width={28} height={28} />}
          {me.user.login}
          <button onClick={() => logout(me.csrfToken).then(() => setState({ status: 'anonymous' }))}>Sign out</button>
        </span>
      </header>
      <p>Signed in. Repo connection and the activity dashboard are coming next.</p>
      <a href={me.installUrl}>Install the GitHub App on your repos →</a>
    </main>
  )
}
