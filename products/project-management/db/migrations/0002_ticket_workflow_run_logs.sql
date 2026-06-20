CREATE TABLE ticket_workflow_run (
  id text PRIMARY KEY,
  ticket_id text NOT NULL,
  phase text NOT NULL,
  attempt integer NOT NULL,
  tmux_session text NOT NULL,
  prompt_path text,
  stdout_log_path text NOT NULL,
  stderr_log_path text NOT NULL,
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  stdout_bytes integer NOT NULL DEFAULT 0,
  stderr_bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX ticket_workflow_run_tmux_session_idx ON ticket_workflow_run (tmux_session);
CREATE INDEX ticket_workflow_run_ticket_id_idx ON ticket_workflow_run (ticket_id);
CREATE INDEX ticket_workflow_run_status_idx ON ticket_workflow_run (status);
