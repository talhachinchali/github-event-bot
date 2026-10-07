# AGENTS.md – context for AI coding assistants

Project: **Repo Sentinel** – a GitHub App + dashboard. Receives GitHub webhooks, applies user rules, writes back to GitHub (labels/comments), notifies Slack. See `PLAN.md` for the roadmap and decisions.

## Stack
- `server/`: Node 20+, Express 5, TypeScript (ESM, NodeNext – use `.js` extensions in relative imports), pino logging, zod validation, Postgres (Neon) via `pg`, vitest.
- `web/`: React + Vite + TypeScript. Built output is served by Express in production.
- npm workspaces at the repo root.

## Commands
- `npm run dev` – server (:3000) + web (:5173, proxies `/api` and `/auth`)
- `npm run typecheck`, `npm test`, `npm run build`

## Non-negotiable rules
1. **Everything free, no credit card.** Never suggest a paid service/tier.
2. **Never commit or log secrets.** Config comes from env vars validated in `server/src/config.ts`. `.env` and `*.pem` are gitignored. Keep `.env.example` current with no real values.
3. **Webhooks:** verify `X-Hub-Signature-256` HMAC over the *raw* body with `crypto.timingSafeEqual` before parsing JSON. Dedupe on `X-GitHub-Delivery`.
4. **Idempotency:** every side effect (GitHub write, Slack message) must be safe to retry and unique per `(event, rule, action)`.
5. **Durability:** persist the event before responding 200; processing happens in the worker with retries/backoff.
6. All mutating dashboard routes require an authenticated session + CSRF protection; users may only touch their own repos/rules.
7. Small, focused commits with clear messages. Update `PLAN.md` step status when a step finishes.

## Conventions
- Validate all external input with zod.
- Use the shared `logger`; log structured objects, never raw tokens/headers.
- Keep modules small: routes -> services -> db.
