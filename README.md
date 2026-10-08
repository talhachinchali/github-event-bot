# Repo Sentinel

A GitHub App that watches your repositories and reacts to activity: adds labels, posts comments, and sends Slack alerts — all driven by rules you configure in a dashboard.

## What it does

| Event | Example rule | Bot action |
|-------|--------------|------------|
| Issue opened | Title contains "bug" | Add `bug` label, post comment, Slack alert |
| PR opened | (any) | Post welcome comment, AI-suggested label, Slack |
| Push to main | (any) | Slack: "3 commits pushed to main by @user" |

- **Configurable rules** in the dashboard: match on title, body, author, labels, branch
- **AI triage** (optional, free Gemini): summarises issues, rates priority, suggests labels
- **Reliable**: signed webhooks, deduped deliveries, automatic retries with backoff, crash recovery
- **Multi-repo**: one install, connect/disconnect repos individually
- **GitHub App auth**: short-lived tokens, no long-lived PATs

## Quick start (local)

```bash
# 1. Clone
git clone https://github.com/talhachinchali/github-event-bot
cd github-event-bot

# 2. Install
npm ci

# 3. Create .env from template
cp .env.example .env
# Fill in all values (see Environment variables below)

# 4. Start Neon (free Postgres) and copy connection string to DATABASE_URL

# 5. Create GitHub App (see GitHub App setup below) and fill GITHUB_APP_* vars

# 6. Create Slack Incoming Webhook and paste URL in dashboard Settings after login

# 7. (Optional) Get Gemini API key from https://aistudio.google.com/apikey

# 8. Run dev servers (two terminals)
npm run dev:server   # API on :3000
npm run dev:web      # React on :5173 (proxies /api to :3000)

# 9. Expose webhook endpoint with ngrok (free)
ngrok http 3000 --url=https://your-domain.ngrok-free.dev

# 10. Set GitHub App webhook URL to https://your-domain.ngrok-free.dev/webhooks/github

# 11. Open http://localhost:5173, sign in, connect a repo, add a rule
```

## Production deploy (Render)

1. Push to GitHub
2. Create Render Web Service → connect repo → `render.yaml` applies
3. Add environment variables in Render dashboard (all except `SESSION_SECRET` and `ENCRYPTION_KEY` which are auto-generated)
4. Deploy → get URL like `https://your-app.onrender.com`
5. Update GitHub App:
   - Homepage URL: `https://your-app.onrender.com`
   - Callback URL: `https://your-app.onrender.com/auth/github/callback`
   - Webhook URL: `https://your-app.onrender.com/webhooks/github`
6. Update Render `APP_URL` to the real URL → redeploys
6. Test

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | `development` / `production` |
| `PORT` | No | Default 3000 |
| `APP_URL` | Yes | Public base URL (e.g. `https://your-app.onrender.com`) |
| `DATABASE_URL` | Yes | Neon pooled connection string |
| `SESSION_SECRET` | Prod | `openssl rand -hex 32` (auto-generated on Render) |
| `ENCRYPTION_KEY` | Prod | `openssl rand -hex 32` (auto-generated on Render) |
| `GITHUB_APP_ID` | Yes | GitHub App ID (number) |
| `GITHUB_APP_CLIENT_ID` | Yes | `Iv...` |
| `GITHUB_APP_CLIENT_SECRET` | Yes | From GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | Yes | Entire PEM (with `\n` newlines in `.env`) |
| `GITHUB_APP_SLUG` | Yes | From GitHub App URL |
| `GITHUB_WEBHOOK_SECRET` | Yes | `openssl rand -hex 32` |
| `GEMINI_API_KEY` | No | Google AI Studio key (for AI triage) |
| `GEMINI_MODEL` | No | Default `gemini-flash-lite-latest` |

## GitHub App setup

1. **Settings → Developer settings → GitHub Apps → New GitHub App**
2. **Name:** unique (e.g. `repo-sentinel-yourname`)
3. **Homepage URL:** your deployed URL (or `http://localhost:3000` for dev)
4. **Callback URL:** `https://your-app.onrender.com/auth/github/callback` (or `http://localhost:3000/auth/github/callback`)
5. **Webhook:** Active → URL: `https://your-app.onrender.com/webhooks/github` (or ngrok), Secret: `GITHUB_WEBHOOK_SECRET`
6. **Repository permissions:**
   - Issues: Read & write
   - Pull requests: Read & write
   - Contents: Read-only
7. **Subscribe to events:** Issues, Pull request, Push
8. **Where can this GitHub App be installed?** Any account
9. **Create** → note **App ID**, **Client ID**, generate **Client Secret**, **Private Key** (downloads `.pem`)
10. **Install** the app on your account/org, choose repos

## Free services used (no credit card)

| Service | Tier |
|---------|------|
| GitHub | Free |
| Neon (Postgres) | Free |
| Slack | Free workspace |
| Render | Free web service |
| ngrok | Free static domain |
| Google AI Studio (Gemini) | Free tier |

## Project structure

```
repo-sentinel/
├── server/          # Express + TypeScript API
│   ├── src/
│   │   ├── auth/        # OAuth, sessions, CSRF, crypto
│   │   ├── github/      # GitHub App JWT, installation tokens, webhooks
│   │   ├── worker/      # Durable queue, retries, rule execution
│   │   ├── rules/       # Condition matching engine
│   │   ├── repos/       # Repo connection logic
│   │   ├── slack/       # Encrypted webhook storage, messaging
│   │   ├── ai/          # Gemini triage (summary, priority, label)
│   │   ├── events/      # Activity feed API + SSE
│   │   └── db/          # Pool, migrations
│   └── migrations/      # 001_init.sql
├── web/             # React + Vite + TypeScript
│   └── src/
│       ├── features/    # Activity, Rules, Repos, Settings
│       ├── components/  # shadcn/ui components
│       └── api.ts       # Typed API client
├── render.yaml       # Render deployment config
├── PLAN.md           # Project plan (internal)
├── AGENTS.md         # AI context (internal)
└── AI_NOTES.md       # AI collaboration notes (internal)
```

## Testing checklist for reviewers

1. Open `https://github-event-bot-2.onrender.com`
2. Sign in with GitHub → authorize the app
3. **Repositories** tab → connect a test repo
4. **Rules** tab → create a rule: "When issue title contains 'bug' → add label 'bug', send Slack"
5. **Settings** tab → paste Slack Incoming Webhook URL → Save → Send test message
6. Open an issue on the connected repo titled "bug: test issue"
7. Verify:
   - ✅ `bug` label added on GitHub
   - ✅ Bot comment posted
   - ✅ Slack message received
   - ✅ Dashboard **Activity** tab shows event with all actions
8. Try a PR rule, AI triage, retry a failed event

## License

MIT
