CREATE TABLE workflow_runs (
  id text PRIMARY KEY,
  ticket_id text NOT NULL,
  workflow_id text NOT NULL,
  run_id text,
  phase text NOT NULL,
  status text NOT NULL,
  builder_attempts integer NOT NULL DEFAULT 0,
  reviewer_attempts integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX workflow_runs_workflow_id_idx ON workflow_runs (workflow_id);
CREATE INDEX workflow_runs_ticket_id_idx ON workflow_runs (ticket_id);
CREATE INDEX workflow_runs_status_idx ON workflow_runs (status);

CREATE TABLE workflow_events (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  ticket_id text NOT NULL,
  type text NOT NULL,
  phase text,
  role text,
  outcome text,
  message text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX workflow_events_workflow_run_id_idx ON workflow_events (workflow_run_id);
CREATE INDEX workflow_events_ticket_id_idx ON workflow_events (ticket_id);
CREATE INDEX workflow_events_occurred_at_idx ON workflow_events (occurred_at);

CREATE TABLE workflow_artifacts (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  ticket_id text NOT NULL,
  kind text NOT NULL,
  path text NOT NULL,
  bytes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX workflow_artifacts_path_idx ON workflow_artifacts (path);
CREATE INDEX workflow_artifacts_workflow_run_id_idx ON workflow_artifacts (workflow_run_id);
CREATE INDEX workflow_artifacts_ticket_id_idx ON workflow_artifacts (ticket_id);
