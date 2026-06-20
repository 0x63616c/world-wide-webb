import { homedir } from "node:os";
import { join } from "node:path";
import { createProjectManagementPool } from "./db/client";

export const WORKFLOW_USAGE_ROLES = ["builder", "reviewer", "mergefix"] as const;

export type WorkflowUsageRole = (typeof WORKFLOW_USAGE_ROLES)[number];

export type OpenCodeSessionUsage = {
  readonly sessionId: string;
  readonly title: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly costUsd: number;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensReasoning: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
};

export type WorkflowUsageRun = OpenCodeSessionUsage & {
  readonly role: WorkflowUsageRole;
  readonly attempt: number | null;
  readonly totalTokens: number;
};

export type WorkflowUsageSummary = {
  readonly ticketId: string;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly runs: readonly WorkflowUsageRun[];
};

export type CaptureOpenCodeUsageInput = {
  readonly ticketId: string;
  readonly role: WorkflowUsageRole;
  readonly attempt: number | null;
  readonly opencodeSessionId: string | null;
};

export type CaptureOpenCodeUsageResult =
  | { readonly ok: true; readonly usage: OpenCodeSessionUsage }
  | { readonly ok: false; readonly reason: string };

type Queryable = {
  readonly query: (sql: string, params?: readonly unknown[]) => Promise<{ readonly rows?: unknown[] }>;
};

type OpenCodeCommandRunner = (command: {
  readonly command: string;
  readonly args: readonly string[];
}) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;

export async function captureOpenCodeUsage(
  input: CaptureOpenCodeUsageInput,
  run: OpenCodeCommandRunner,
  db: Queryable,
): Promise<CaptureOpenCodeUsageResult> {
  if (!input.opencodeSessionId) return { ok: false, reason: "opencode session id is unknown" };
  const usage = await readOpenCodeSessionUsage(input.opencodeSessionId, run);
  if (!usage) return { ok: false, reason: "opencode usage is unavailable" };
  await upsertOpenCodeUsage(db, input, usage);
  return { ok: true, usage };
}

export async function captureOpenCodeUsageActivitySafe(
  input: CaptureOpenCodeUsageInput,
  run: OpenCodeCommandRunner,
): Promise<CaptureOpenCodeUsageResult> {
  if (!Bun.env.PROJECT_MANAGEMENT_DATABASE_URL) {
    return { ok: false, reason: "PROJECT_MANAGEMENT_DATABASE_URL is not configured" };
  }
  const pool = createProjectManagementPool();
  try {
    return await captureOpenCodeUsage(input, run, pool);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await pool.end();
  }
}

export async function readOpenCodeSessionUsage(
  sessionId: string,
  run: OpenCodeCommandRunner,
): Promise<OpenCodeSessionUsage | null> {
  const dbPath = join(homedir(), ".local/share/opencode/opencode.db");
  const sql = [
    "select",
    [
      "id",
      "title",
      "coalesce(agent, '')",
      "coalesce(model, '')",
      "coalesce(cost, 0)",
      "coalesce(tokens_input, 0)",
      "coalesce(tokens_output, 0)",
      "coalesce(tokens_reasoning, 0)",
      "coalesce(tokens_cache_read, 0)",
      "coalesce(tokens_cache_write, 0)",
    ].join(" || char(9) || "),
    "from session where id =",
    quoteSql(sessionId),
    "limit 1;",
  ].join(" ");
  const result = await run({ command: "sqlite3", args: ["-readonly", dbPath, sql] });
  if (result.exitCode !== 0) return null;
  return parseOpenCodeSessionUsageRow(result.stdout.trim());
}

export function parseOpenCodeSessionUsageRow(row: string): OpenCodeSessionUsage | null {
  if (!row.trim()) return null;
  const parts = row.split("\t");
  if (parts.length !== 10) return null;
  const [
    sessionId,
    title,
    agent,
    model,
    costUsd,
    tokensInput,
    tokensOutput,
    tokensReasoning,
    tokensCacheRead,
    tokensCacheWrite,
  ] = parts;
  if (!sessionId) return null;
  return {
    sessionId,
    title: nullableText(title),
    agent: nullableText(agent),
    model: nullableText(model),
    costUsd: safeNumber(costUsd),
    tokensInput: safeInteger(tokensInput),
    tokensOutput: safeInteger(tokensOutput),
    tokensReasoning: safeInteger(tokensReasoning),
    tokensCacheRead: safeInteger(tokensCacheRead),
    tokensCacheWrite: safeInteger(tokensCacheWrite),
  };
}

export async function upsertOpenCodeUsage(
  db: Queryable,
  input: CaptureOpenCodeUsageInput,
  usage: OpenCodeSessionUsage,
): Promise<void> {
  await db.query(
    `
      INSERT INTO workflow_opencode_usage (
        id, ticket_id, role, attempt, opencode_session_id, title, agent, model, cost_usd,
        tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (opencode_session_id) DO UPDATE SET
        ticket_id = EXCLUDED.ticket_id,
        role = EXCLUDED.role,
        attempt = EXCLUDED.attempt,
        title = EXCLUDED.title,
        agent = EXCLUDED.agent,
        model = EXCLUDED.model,
        cost_usd = EXCLUDED.cost_usd,
        tokens_input = EXCLUDED.tokens_input,
        tokens_output = EXCLUDED.tokens_output,
        tokens_reasoning = EXCLUDED.tokens_reasoning,
        tokens_cache_read = EXCLUDED.tokens_cache_read,
        tokens_cache_write = EXCLUDED.tokens_cache_write,
        updated_at = now()
    `,
    [
      workflowUsageId(usage.sessionId),
      input.ticketId,
      input.role,
      input.attempt,
      usage.sessionId,
      usage.title,
      usage.agent,
      usage.model,
      usage.costUsd,
      usage.tokensInput,
      usage.tokensOutput,
      usage.tokensReasoning,
      usage.tokensCacheRead,
      usage.tokensCacheWrite,
    ],
  );
}

export async function loadWorkflowUsageSummaries(
  ticketIds: readonly string[],
): Promise<Record<string, WorkflowUsageSummary>> {
  if (ticketIds.length === 0 || !Bun.env.PROJECT_MANAGEMENT_DATABASE_URL) return {};
  const pool = createProjectManagementPool();
  try {
    const result = await pool.query(
      `
        SELECT ticket_id, role, attempt, opencode_session_id, title, agent, model, cost_usd,
          tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write
        FROM workflow_opencode_usage
        WHERE ticket_id = ANY($1::text[])
        ORDER BY ticket_id, captured_at, role
      `,
      [ticketIds],
    );
    return aggregateWorkflowUsageRows(result.rows as WorkflowUsageTableRow[]);
  } catch {
    return {};
  } finally {
    await pool.end();
  }
}

export type WorkflowUsageTableRow = {
  readonly ticket_id: string;
  readonly role: string;
  readonly attempt: number | null;
  readonly opencode_session_id: string;
  readonly title: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly cost_usd: number | string | null;
  readonly tokens_input: number | string | null;
  readonly tokens_output: number | string | null;
  readonly tokens_reasoning: number | string | null;
  readonly tokens_cache_read: number | string | null;
  readonly tokens_cache_write: number | string | null;
};

export function aggregateWorkflowUsageRows(
  rows: readonly WorkflowUsageTableRow[],
): Record<string, WorkflowUsageSummary> {
  const summaries = new Map<string, { totalTokens: number; costUsd: number; runs: WorkflowUsageRun[] }>();
  for (const row of rows) {
    const role = parseWorkflowUsageRole(row.role);
    if (!role) continue;
    const run = rowToUsageRun(row, role);
    const current = summaries.get(row.ticket_id) ?? { totalTokens: 0, costUsd: 0, runs: [] };
    current.totalTokens += run.totalTokens;
    current.costUsd += run.costUsd;
    current.runs.push(run);
    summaries.set(row.ticket_id, current);
  }
  return Object.fromEntries(
    [...summaries.entries()].map(([ticketId, summary]) => [
      ticketId,
      {
        ticketId,
        totalTokens: summary.totalTokens,
        costUsd: Number(summary.costUsd.toFixed(6)),
        runs: summary.runs,
      },
    ]),
  );
}

function rowToUsageRun(row: WorkflowUsageTableRow, role: WorkflowUsageRole): WorkflowUsageRun {
  const usage = {
    sessionId: row.opencode_session_id,
    title: row.title,
    agent: row.agent,
    model: row.model,
    costUsd: safeNumber(row.cost_usd),
    tokensInput: safeInteger(row.tokens_input),
    tokensOutput: safeInteger(row.tokens_output),
    tokensReasoning: safeInteger(row.tokens_reasoning),
    tokensCacheRead: safeInteger(row.tokens_cache_read),
    tokensCacheWrite: safeInteger(row.tokens_cache_write),
  } satisfies OpenCodeSessionUsage;
  return { ...usage, role, attempt: row.attempt, totalTokens: totalTokens(usage) };
}

function parseWorkflowUsageRole(role: string): WorkflowUsageRole | null {
  return WORKFLOW_USAGE_ROLES.includes(role as WorkflowUsageRole) ? (role as WorkflowUsageRole) : null;
}

function totalTokens(usage: OpenCodeSessionUsage): number {
  return (
    usage.tokensInput +
    usage.tokensOutput +
    usage.tokensReasoning +
    usage.tokensCacheRead +
    usage.tokensCacheWrite
  );
}

function workflowUsageId(sessionId: string): string {
  return `opu_${sessionId.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function nullableText(value: string): string | null {
  return value.trim() ? value : null;
}

function safeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeInteger(value: unknown): number {
  return Math.trunc(safeNumber(value));
}

function quoteSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
