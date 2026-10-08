# AI_NOTES

_Work in progress – filled in as the project progresses; finalized in step 12._

## Tools and models
- OpenCode agent harness (model: Exo Free) for scaffolding and implementation, driven step by step from `PLAN.md`.

## Split of work
- Me: requirements, architecture and service choices, creating external accounts/keys, reviewing and testing.
- AI: scaffolding, boilerplate, implementation of each planned step, tests.

## Key decisions (mine)
1. **GitHub App over OAuth App** — single registration handles login, webhooks, and write-back; short-lived installation tokens; native multi-repo support via installations.
2. **PostgreSQL as the queue** — no Redis needed; Neon free tier; durable inbox with `FOR UPDATE SKIP LOCKED` for crash recovery and atomic claim; reconciler redelivers failed webhooks.
3. **shadcn/ui + Tailwind** — components live in the repo, fully typed, accessible, light/dark mode, no heavy runtime; I already knew the stack.
4. **AI triage as opt-in per rule** — never blocks the bot (best-effort), result cached on the event so retries don't re-call the model, labels restricted to a fixed allow-list to prevent prompt injection.

## Hardest bug / wrong turn
The project went smoothly overall; the main friction points were operational rather than code bugs:
- **ngrok port confusion** — an old tunnel on port 80 caused 502s; killed it and restarted on port 3000.
- **Render cold-start latency** — first query ~4.5s from India to Ohio; fixed by keeping pool connections alive (`idleTimeoutMillis: 120_000`, `keepAlive: true`).
- **Logout UI race** — clearing the query cache after logout could race with a background refetch; fixed with `cancelQueries` before `setQueryData(null)`.

None of these were AI-introduced logic errors; they were environment/integration issues caught during manual testing.

## What I'd improve with more time
1. **Retry button for dead events** in the dashboard — currently a dead event stays dead until manual DB intervention.
2. **Rule templates / import-export** — share rules across repos or users.
3. **Webhook delivery UI** — link to GitHub's "Recent Deliveries" page from the event detail view.
4. **Rule builder UX** — drag-and-drop condition builder, validation preview.
5. **Better cold-start handling** — a small warm-up ping or pgBouncer to keep connections hot.

## Optional: prompt excerpt for the trickiest part
The logout race fix came from this prompt:
> "The logout UI doesn't update until refresh. The query cache clear + set to null races with a refetch. Fix it."

AI response introduced `cancelQueries` before `setQueryData`, which solved it cleanly.
