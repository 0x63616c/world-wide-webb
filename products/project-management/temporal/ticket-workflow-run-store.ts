import { createProjectManagementPool } from "../db/client";

export type TicketWorkflowRunPhase = "build" | "review" | "mergefix";

export type TicketWorkflowRunStatus = "running" | "completed" | "failed" | "timed_out";

export type TicketWorkflowRunStart = {
  readonly ticketId: string;
  readonly phase: TicketWorkflowRunPhase;
  readonly attempt: number;
  readonly tmuxSession: string;
  readonly promptPath?: string;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly startedAt: Date;
};

export type TicketWorkflowRunOutput = {
  readonly tmuxSession: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly status?: TicketWorkflowRunStatus;
  readonly completedAt?: Date;
};

export type QueryResult<Row> = {
  readonly rows: readonly Row[];
};

export type TicketWorkflowRunQueryClient = {
  readonly query: <Row = unknown>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<QueryResult<Row>>;
};

export async function recordTicketWorkflowRunStart(
  input: TicketWorkflowRunStart,
  client?: TicketWorkflowRunQueryClient,
): Promise<void> {
  await withTicketWorkflowRunClient(client, async (db) => {
    await recordTicketWorkflowRunStartWithClient(input, db);
  });
}

export async function syncTicketWorkflowRunOutput(
  input: TicketWorkflowRunOutput,
  client?: TicketWorkflowRunQueryClient,
): Promise<void> {
  await withTicketWorkflowRunClient(client, async (db) => {
    await syncTicketWorkflowRunOutputWithClient(input, db);
  });
}

async function recordTicketWorkflowRunStartWithClient(
  input: TicketWorkflowRunStart,
  client: TicketWorkflowRunQueryClient,
): Promise<void> {
  await client.query(
    `
      INSERT INTO ticket_workflow_run (
        id,
        ticket_id,
        phase,
        attempt,
        tmux_session,
        prompt_path,
        stdout_log_path,
        stderr_log_path,
        status,
        started_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', $9, $9)
      ON CONFLICT (tmux_session) DO UPDATE SET
        ticket_id = EXCLUDED.ticket_id,
        phase = EXCLUDED.phase,
        attempt = EXCLUDED.attempt,
        prompt_path = COALESCE(EXCLUDED.prompt_path, ticket_workflow_run.prompt_path),
        stdout_log_path = EXCLUDED.stdout_log_path,
        stderr_log_path = EXCLUDED.stderr_log_path,
        status = 'running',
        updated_at = EXCLUDED.updated_at
    `,
    [
      ticketWorkflowRunId(input.tmuxSession),
      input.ticketId,
      input.phase,
      input.attempt,
      input.tmuxSession,
      input.promptPath ?? null,
      input.stdoutLogPath,
      input.stderrLogPath,
      input.startedAt,
    ],
  );
}

type TicketWorkflowRunOffsets = {
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
};

async function syncTicketWorkflowRunOutputWithClient(
  input: TicketWorkflowRunOutput,
  client: TicketWorkflowRunQueryClient,
): Promise<void> {
  const existing = await client.query<TicketWorkflowRunOffsets>(
    `
      SELECT stdout_bytes, stderr_bytes
      FROM ticket_workflow_run
      WHERE tmux_session = $1
    `,
    [input.tmuxSession],
  );
  const row = existing.rows[0];
  if (!row) return;

  const stdoutChunk = unreadUtf8Chunk(input.stdout, row.stdout_bytes);
  const stderrChunk = unreadUtf8Chunk(input.stderr, row.stderr_bytes);
  await client.query(
    `
      UPDATE ticket_workflow_run
      SET
        stdout = stdout || $2,
        stderr = stderr || $3,
        stdout_bytes = stdout_bytes + $4,
        stderr_bytes = stderr_bytes + $5,
        status = COALESCE($6, status),
        completed_at = COALESCE($7, completed_at),
        updated_at = $8
      WHERE tmux_session = $1
    `,
    [
      input.tmuxSession,
      stdoutChunk,
      stderrChunk,
      Buffer.byteLength(stdoutChunk),
      Buffer.byteLength(stderrChunk),
      input.status ?? null,
      input.completedAt ?? null,
      input.completedAt ?? new Date(),
    ],
  );
}

async function withTicketWorkflowRunClient(
  client: TicketWorkflowRunQueryClient | undefined,
  callback: (client: TicketWorkflowRunQueryClient) => Promise<void>,
): Promise<void> {
  if (client) {
    await callback(client);
    return;
  }
  const databaseUrl = runtimeEnv().PROJECT_MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) return;

  const pool = createProjectManagementPool(databaseUrl);
  try {
    await callback(pool);
  } finally {
    await pool.end();
  }
}

function unreadUtf8Chunk(value: string, existingBytes: number): string {
  const bytes = Buffer.from(value);
  if (existingBytes >= bytes.length) return "";
  return bytes.subarray(existingBytes).toString("utf8");
}

function ticketWorkflowRunId(tmuxSession: string): string {
  return `twr_${tmuxSession}`;
}

function runtimeEnv(): Record<string, string | undefined> {
  return globalThis.Bun?.env ?? {};
}
