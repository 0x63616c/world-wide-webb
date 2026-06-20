import { describe, expect, it } from "vitest";
import {
  aggregateWorkflowUsageRows,
  captureOpenCodeUsage,
  parseOpenCodeSessionUsageRow,
  upsertOpenCodeUsage,
  type WorkflowUsageTableRow,
} from "./opencode-usage";

describe("OpenCode workflow usage", () => {
  it("parses OpenCode session usage rows", () => {
    const usage = parseOpenCodeSessionUsageRow(
      ["ses_123", "Builder", "ticket-builder", "openai/gpt-5.5", "0.125", "100", "25", "50", "10", "5"].join(
        "\t",
      ),
    );

    expect(usage).toEqual({
      sessionId: "ses_123",
      title: "Builder",
      agent: "ticket-builder",
      model: "openai/gpt-5.5",
      costUsd: 0.125,
      tokensInput: 100,
      tokensOutput: 25,
      tokensReasoning: 50,
      tokensCacheRead: 10,
      tokensCacheWrite: 5,
    });
  });

  it("upserts usage idempotently by OpenCode session id", async () => {
    const db = fakeUsageDb();
    const input = { ticketId: "www-3x1s", role: "builder", attempt: 1, opencodeSessionId: "ses_123" } as const;
    const usage = {
      sessionId: "ses_123",
      title: "Builder",
      agent: "ticket-builder",
      model: "openai/gpt-5.5",
      costUsd: 0.25,
      tokensInput: 100,
      tokensOutput: 50,
      tokensReasoning: 25,
      tokensCacheRead: 10,
      tokensCacheWrite: 5,
    };

    await upsertOpenCodeUsage(db, input, usage);
    await upsertOpenCodeUsage(db, input, { ...usage, costUsd: 0.5, tokensOutput: 75 });

    expect(db.calls).toHaveLength(2);
    expect(db.calls[0]?.sql).toContain("ON CONFLICT (opencode_session_id) DO UPDATE");
    expect(db.calls[0]?.params?.[4]).toBe("ses_123");
    expect(db.calls[1]?.params?.[8]).toBe(0.5);
    expect(db.calls[1]?.params?.[10]).toBe(75);
  });

  it("captures unavailable OpenCode usage without throwing", async () => {
    const db = fakeUsageDb();
    const result = await captureOpenCodeUsage(
      { ticketId: "www-3x1s", role: "reviewer", attempt: 1, opencodeSessionId: "ses_missing" },
      async () => ({ exitCode: 1, stdout: "", stderr: "database locked" }),
      db,
    );

    expect(result).toEqual({ ok: false, reason: "opencode usage is unavailable" });
    expect(db.calls).toHaveLength(0);
  });

  it("aggregates per-ticket totals and per-run breakdowns", () => {
    const summaries = aggregateWorkflowUsageRows([
      usageRow({ role: "builder", opencode_session_id: "ses_builder", cost_usd: 0.25, tokens_input: 100, tokens_output: 50 }),
      usageRow({ role: "reviewer", opencode_session_id: "ses_reviewer", cost_usd: 0.1, tokens_reasoning: 25 }),
    ]);

    expect(summaries["www-3x1s"]).toEqual({
      ticketId: "www-3x1s",
      totalTokens: 175,
      costUsd: 0.35,
      runs: [
        expect.objectContaining({ role: "builder", sessionId: "ses_builder", totalTokens: 150 }),
        expect.objectContaining({ role: "reviewer", sessionId: "ses_reviewer", totalTokens: 25 }),
      ],
    });
  });
});

function fakeUsageDb() {
  return {
    calls: [] as { readonly sql: string; readonly params?: readonly unknown[] }[],
    async query(sql: string, params?: readonly unknown[]) {
      this.calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

function usageRow(overrides: Partial<WorkflowUsageTableRow>): WorkflowUsageTableRow {
  return {
    ticket_id: "www-3x1s",
    role: "builder",
    attempt: 1,
    opencode_session_id: "ses_default",
    title: null,
    agent: null,
    model: null,
    cost_usd: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    ...overrides,
  };
}
