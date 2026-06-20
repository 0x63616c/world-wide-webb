CREATE TABLE workflow_opencode_usage (
  id text PRIMARY KEY,
  ticket_id text NOT NULL,
  role text NOT NULL,
  attempt integer,
  opencode_session_id text NOT NULL,
  title text,
  agent text,
  model text,
  cost_usd double precision NOT NULL DEFAULT 0,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  tokens_reasoning integer NOT NULL DEFAULT 0,
  tokens_cache_read integer NOT NULL DEFAULT 0,
  tokens_cache_write integer NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX workflow_opencode_usage_session_idx ON workflow_opencode_usage (opencode_session_id);
CREATE INDEX workflow_opencode_usage_ticket_id_idx ON workflow_opencode_usage (ticket_id);
