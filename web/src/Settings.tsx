import { useEffect, useState } from 'react'
import { UnauthenticatedError, fetchSlackStatus, removeSlackWebhook, saveSlackWebhook, testSlack, type Me } from './api'

export default function Settings({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const fail = (e: unknown) => {
    if (e instanceof UnauthenticatedError) return onSignedOut()
    setMessage({ text: (e as Error).message, ok: false })
  }

  useEffect(() => {
    fetchSlackStatus().then((s) => setConfigured(s.configured)).catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage(null)
    try { await action() } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <section>
      <h2>Slack notifications</h2>
      <p className="muted">
        Status: {configured === null ? '…' : configured ? 'connected ✅' : 'not connected'}.
        Create an <em>Incoming Webhook</em> in your Slack app and paste its URL here. It is stored encrypted and never shown again.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await saveSlackWebhook(me.csrfToken, url.trim())
            setUrl(''); setConfigured(true)
            setMessage({ text: 'Saved. Use "Send test message" to verify.', ok: true })
          })
        }}
      >
        <input
          type="password" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder={configured ? 'Paste a new URL to replace the saved one' : 'https://hooks.slack.com/services/…'}
          aria-label="Slack webhook URL"
        />
        <button type="submit" disabled={busy || url.trim() === ''}>Save</button>
      </form>
      {configured && (
        <div className="row">
          <button disabled={busy} onClick={() => void run(async () => {
            await testSlack(me.csrfToken)
            setMessage({ text: 'Test message sent. Check your Slack channel.', ok: true })
          })}>Send test message</button>
          <button className="danger" disabled={busy} onClick={() => void run(async () => {
            await removeSlackWebhook(me.csrfToken); setConfigured(false)
            setMessage({ text: 'Slack webhook removed.', ok: true })
          })}>Remove</button>
        </div>
      )}
      {message && <p role="status" className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
    </section>
  )
}
