import { describe, expect, it } from "vitest";
import {
  type QueryResult,
  recordTicketWorkflowRunStart,
  syncTicketWorkflowRunOutput,
  type TicketWorkflowRunQueryClient,
} from "./ticket-workflow-run-store";

describe("ticket workflow run store", () => {
  it("creates or updates a ticket workflow run row when an agent phase starts", async () => {
    const db = fakeTicketWorkflowRunClient();

    await recordTicketWorkflowRunStart(
      {
        ticketId: "www-z0la",
        phase: "build",
        attempt: 1,
        tmuxSession: "ticket_www-z0la_build_1",
        promptPath: "/logs/prompt.md",
        stdoutLogPath: "/logs/stdout.log",
        stderrLogPath: "/logs/stderr.log",
        startedAt: new Date("2026-06-20T00:00:00.000Z"),
      },
      db,
    );

    expect(db.rows.get("ticket_www-z0la_build_1")).toEqual(
      expect.objectContaining({
        ticketId: "www-z0la",
        phase: "build",
        attempt: 1,
        promptPath: "/logs/prompt.md",
        stdoutLogPath: "/logs/stdout.log",
        stderrLogPath: "/logs/stderr.log",
        status: "running",
      }),
    );
  });

  it("appends idempotent stdout and stderr chunks separately", async () => {
    const db = fakeTicketWorkflowRunClient();
    await seedStartedRun(db);

    await syncTicketWorkflowRunOutput(
      { tmuxSession: "ticket_www-z0la_build_1", stdout: "hello", stderr: "warn" },
      db,
    );
    await syncTicketWorkflowRunOutput(
      { tmuxSession: "ticket_www-z0la_build_1", stdout: "hello world", stderr: "warn\nagain" },
      db,
    );
    await syncTicketWorkflowRunOutput(
      { tmuxSession: "ticket_www-z0la_build_1", stdout: "hello world", stderr: "warn\nagain" },
      db,
    );

    expect(db.rows.get("ticket_www-z0la_build_1")).toEqual(
      expect.objectContaining({
        stdout: "hello world",
        stderr: "warn\nagain",
        stdoutBytes: Buffer.byteLength("hello world"),
        stderrBytes: Buffer.byteLength("warn\nagain"),
      }),
    );
  });

  it("stores final completion status after the final stdout and stderr sync", async () => {
    const db = fakeTicketWorkflowRunClient();
    await seedStartedRun(db);
    const completedAt = new Date("2026-06-20T00:01:00.000Z");

    await syncTicketWorkflowRunOutput(
      {
        tmuxSession: "ticket_www-z0la_build_1",
        stdout: "done",
        stderr: "",
        status: "completed",
        completedAt,
      },
      db,
    );

    expect(db.rows.get("ticket_www-z0la_build_1")).toEqual(
      expect.objectContaining({
        stdout: "done",
        status: "completed",
        completedAt,
      }),
    );
  });
});

type FakeTicketWorkflowRun = {
  readonly tmuxSession: string;
  ticketId: string;
  phase: string;
  attempt: number;
  promptPath: string | null;
  stdoutLogPath: string;
  stderrLogPath: string;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  status: string;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type FakeTicketWorkflowRunClient = TicketWorkflowRunQueryClient & {
  readonly rows: Map<string, FakeTicketWorkflowRun>;
};

async function seedStartedRun(db: FakeTicketWorkflowRunClient): Promise<void> {
  await recordTicketWorkflowRunStart(
    {
      ticketId: "www-z0la",
      phase: "build",
      attempt: 1,
      tmuxSession: "ticket_www-z0la_build_1",
      promptPath: "/logs/prompt.md",
      stdoutLogPath: "/logs/stdout.log",
      stderrLogPath: "/logs/stderr.log",
      startedAt: new Date("2026-06-20T00:00:00.000Z"),
    },
    db,
  );
}

function fakeTicketWorkflowRunClient(): FakeTicketWorkflowRunClient {
  const rows = new Map<string, FakeTicketWorkflowRun>();
  return {
    rows,
    async query<Row = unknown>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      if (sql.includes("INSERT INTO ticket_workflow_run")) {
        const tmuxSession = String(params[4]);
        rows.set(tmuxSession, {
          tmuxSession,
          ticketId: String(params[1]),
          phase: String(params[2]),
          attempt: Number(params[3]),
          promptPath: typeof params[5] === "string" ? params[5] : null,
          stdoutLogPath: String(params[6]),
          stderrLogPath: String(params[7]),
          stdout: rows.get(tmuxSession)?.stdout ?? "",
          stderr: rows.get(tmuxSession)?.stderr ?? "",
          stdoutBytes: rows.get(tmuxSession)?.stdoutBytes ?? 0,
          stderrBytes: rows.get(tmuxSession)?.stderrBytes ?? 0,
          status: "running",
          startedAt: params[8] as Date,
          updatedAt: params[8] as Date,
          completedAt: null,
        });
        return { rows: [] };
      }
      if (sql.includes("SELECT stdout_bytes, stderr_bytes")) {
        const row = rows.get(String(params[0]));
        return {
          rows: row
            ? ([{ stdout_bytes: row.stdoutBytes, stderr_bytes: row.stderrBytes }] as Row[])
            : [],
        };
      }
      if (sql.includes("UPDATE ticket_workflow_run")) {
        const row = rows.get(String(params[0]));
        if (row) {
          const stdoutChunk = String(params[1]);
          const stderrChunk = String(params[2]);
          row.stdout += stdoutChunk;
          row.stderr += stderrChunk;
          row.stdoutBytes += Number(params[3]);
          row.stderrBytes += Number(params[4]);
          row.status = typeof params[5] === "string" ? params[5] : row.status;
          row.completedAt = params[6] instanceof Date ? params[6] : row.completedAt;
          row.updatedAt = params[7] as Date;
        }
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}
