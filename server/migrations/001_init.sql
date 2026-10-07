-- Repo Sentinel initial schema.
-- GitHub ids (users, installations, repos) are used as primary keys; they fit in JS safe integers.

CREATE TABLE users (
  id          BIGINT PRIMARY KEY,               -- GitHub user id
  login       TEXT NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the SHA-256 of the session token is stored, so a DB leak cannot be replayed as cookies.
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,             -- sha256(token) hex
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token      TEXT NOT NULL,
  gh_token_enc    TEXT,                         -- AES-GCM encrypted GitHub user token (short lived)
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- GitHub App installations (an account/org that installed the app).
CREATE TABLE installations (
  id                    BIGINT PRIMARY KEY,     -- GitHub installation id
  account_login         TEXT NOT NULL,
  account_type          TEXT NOT NULL,          -- 'User' | 'Organization'
  repository_selection  TEXT NOT NULL DEFAULT 'selected',
  suspended_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A repository a user has connected to the bot.
CREATE TABLE repos (
  id               BIGINT PRIMARY KEY,          -- GitHub repo id
  installation_id  BIGINT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  owner_user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL,               -- owner/name
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX repos_owner_idx ON repos(owner_user_id);
CREATE INDEX repos_installation_idx ON repos(installation_id);

-- One Slack incoming webhook per user. The URL is a secret: stored encrypted.
CREATE TABLE slack_configs (
  user_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  webhook_url_enc  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User-defined automation rules, per repo.
--   conditions: [{ "field": "title|body|author|label", "op": "contains|equals|not_contains|matches", "value": "..." }]  (AND)
--   actions:    [{ "type": "add_label", "label": "bug" } | { "type": "comment", "body": "..." } | { "type": "slack" }]
CREATE TABLE rules (
  id          BIGSERIAL PRIMARY KEY,
  repo_id     BIGINT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  event_type  TEXT NOT NULL CHECK (event_type IN ('issues', 'pull_request', 'push')),
  conditions  JSONB NOT NULL DEFAULT '[]',
  actions     JSONB NOT NULL DEFAULT '[]',
  use_ai      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rules_repo_idx ON rules(repo_id);

-- Inbox + work queue. A row is written BEFORE the webhook is acknowledged, so events are never lost.
-- delivery_id UNIQUE = webhook replay / duplicate delivery is a no-op.
CREATE TABLE events (
  id               BIGSERIAL PRIMARY KEY,
  delivery_id      TEXT NOT NULL UNIQUE,        -- X-GitHub-Delivery
  repo_id          BIGINT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,               -- issues | pull_request | push
  action           TEXT,                        -- opened, closed, ...
  title            TEXT,
  author           TEXT,
  url              TEXT,
  payload          JSONB NOT NULL,              -- normalized subset of the webhook payload
  ai               JSONB,                       -- AI triage result (summary, label, priority)
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts         INT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at        TIMESTAMPTZ,
  last_error       TEXT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ
);
CREATE INDEX events_queue_idx ON events(status, next_attempt_at);
CREATE INDEX events_repo_received_idx ON events(repo_id, received_at DESC);

-- Every action attempt the bot made (the dashboard "what did the bot do" log).
CREATE TABLE actions (
  id          BIGSERIAL PRIMARY KEY,
  event_id    BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rule_id     BIGINT REFERENCES rules(id) ON DELETE SET NULL,
  action_key  TEXT NOT NULL,                    -- e.g. "rule:12:add_label:bug"
  type        TEXT NOT NULL,                    -- add_label | comment | slack | ai_triage
  status      TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  attempt     INT NOT NULL DEFAULT 1,
  error       TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX actions_event_idx ON actions(event_id);
-- Idempotency: a given action may succeed at most once per event, even if the event is retried.
CREATE UNIQUE INDEX actions_once_idx ON actions(event_id, action_key) WHERE status = 'success';
