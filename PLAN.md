# Repo Sentinel – Project Plan

A GitHub App + web dashboard that reacts to repository activity: it receives webhooks, applies user-defined rules, writes back to GitHub (labels/comments) and notifies Slack. Everything runs on free tiers, no credit card.

## Decisions

| Area | Choice |
|---|---|
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite (built and served by Express) |
| Database | Neon (free Postgres) |
| GitHub integration | GitHub App (JWT -> installation tokens; user login via the App's OAuth) |
| Notifications | Slack Incoming Webhook (per-user, encrypted at rest) |
| AI | Google Gemini (AI Studio free tier) or Groq |
| Hosting | Render (free web service), single public URL |
| Stretch goals targeted | Configurable rules UI, multi-repo, AI triage, observability + retries |

## Architecture

One Express service serves the API, the webhook endpoint and the built React app. A background worker runs in the same process; Postgres is the queue (no Redis).

```
GitHub --webhook--> POST /webhooks/github
                     1. verify HMAC-SHA256 on the raw body (timing-safe)
                     2. insert into events (UNIQUE delivery_id) -> respond 200 immediately
                                   |
                     worker loop (FOR UPDATE SKIP LOCKED)
                     3. load repo rules, run AI triage (optional)
                     4. execute actions: GitHub label/comment, Slack message
                     5. record each attempt, retry with backoff, then dead-letter
                                   |
React dashboard <-- SSE/poll -- events + actions log, rules editor, repo manager
```

## Quality bar -> approach

| Requirement | Approach |
|---|---|
| Forged requests | HMAC check on raw body with `timingSafeEqual`; OAuth `state` verified; httpOnly + Secure + SameSite session cookies; CSRF protection on mutating routes |
| Replays / duplicates | `delivery_id` unique (redelivery is a no-op); actions unique on `(event_id, rule_id, action_type)`; label calls idempotent; comments carry a hidden marker |
| Lost events | Persist before returning 200; worker retries with exponential backoff, then dead-letters; stale `processing` rows are re-claimed on startup |
| Secrets | Env vars only; pino redaction; Slack URLs encrypted with AES-GCM; App private key only as env var; `.env` gitignored |
| Free host sleeping | Durable inbox + free UptimeRobot ping on `/healthz` |

## Data model

`users`, `sessions`, `installations`, `repos`, `rules`, `events`, `actions` (one row per attempt with status and error), `slack_configs`.

## Steps

Status legend: [ ] todo, [~] in progress, [x] done

1. [x] **Scaffold** – monorepo (`server/`, `web/`), TypeScript, lint, `.env.example`, `AGENTS.md`, start `AI_NOTES.md`
2. [x] **Database** – Neon, migrations, schema
3. [x] **Auth** – GitHub App user login, sessions, protected `/api/me`
4. [x] **Repos** – list installations/repos the user owns; connect/disconnect (multi-repo)
5. [x] **Webhooks** – signature check, dedupe, persistence; `issues`, `pull_request`, `push`
6. [x] **Worker + rules engine** – queue, retries, matching on title/body/author/labels; startup recovery of stuck `processing` rows
7. [x] **Actions** – GitHub write-back via installation tokens; Slack notifications; **delivery reconciler**: GitHub does not auto-retry failed webhooks, so poll `GET /app/hook/deliveries` (app JWT) and redeliver failures (covers downtime / free-tier cold starts)
8. [x] **AI triage** – summary, suggested label, priority; fallback on failure
9. [~] **Dashboard** – login, live event/action log, rules editor, repo settings, failures/retry view
10. [ ] **Tests** – signature, dedupe, rule matching, webhook integration test
11. [ ] **Deploy** – Render + Neon; GitHub App and Slack app pointed at the live URL
12. [ ] **Docs** – README, `AI_NOTES.md`, demo repo, test instructions

## Accounts needed (all free, no card)

- GitHub (create a GitHub App in step 3)
- Neon (step 2)
- Slack workspace + Incoming Webhook (step 7)
- Render (step 11)
- Google AI Studio API key (step 8)

## Deliverables checklist

- [ ] Public GitHub repo with clear commit history
- [ ] Live deployed URL
- [ ] README.md (what it does, run locally, env vars, deployment)
- [ ] `.env.example` with no real secrets
- [ ] Test instructions + demo repo/credentials
- [ ] AI context files (`AGENTS.md`) exactly as used
- [ ] `AI_NOTES.md` (tools/models, 2-3 key decisions, hardest bug, future work)
